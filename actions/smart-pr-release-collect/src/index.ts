import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as core from '@actions/core'
import { createDefaultContext, createDefaultDeps, type RunContext, type RunDeps } from '#core/cli-types.js'
import { createGitHubClientFromEnv, type GitHubClient } from '#core/github-api.js'
import { maskSensitive } from '#core/mask-sensitive.js'
import type {
  CommitInfo,
  PRCache,
  PRCacheEntry,
  PullRequestDetail,
  ReleaseMetadata,
  ReleaseStats,
} from '#core/types.js'

const CACHE_VERSION = 1
const MAX_CACHE_ENTRIES = 100 // Maximum cache entries
const MAX_CACHE_SIZE_BYTES = 100 * 1024 * 1024 // Maximum cache size (100MB)

/**
 * Validate that the given path is within the allowed base directory
 * to prevent path traversal attacks (symlinks are completely prohibited)
 */
async function validatePath(inputPath: string, baseDir: string): Promise<string> {
  const resolvedBase = path.resolve(baseDir)

  // Verify baseDir itself is not a symlink
  try {
    const baseDirStats = await fs.lstat(resolvedBase)
    if (baseDirStats.isSymbolicLink()) {
      throw new Error('Invalid base directory: symlinks are not allowed')
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error('Base directory does not exist')
    }
    // Re-throw symlink error or other errors
    throw error
  }

  const resolved = path.resolve(resolvedBase, inputPath)

  // Check relative path doesn't escape base directory
  const relativePath = path.relative(resolvedBase, resolved)
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error('Invalid path: outside allowed directory')
  }

  // Check each existing segment for symlinks (complete prohibition)
  let currentPath = resolvedBase
  const segments = relativePath.split(path.sep)

  for (const segment of segments) {
    currentPath = path.join(currentPath, segment)
    try {
      const stats = await fs.lstat(currentPath)
      if (stats.isSymbolicLink()) {
        throw new Error('Invalid path: symlinks are not allowed')
      }
    } catch (error) {
      // If path doesn't exist yet, that's OK (will be created)
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        break
      }
      // Re-throw symlink error or other errors
      throw error
    }
  }

  return resolved
}

function isEnvFile(baseName: string): boolean {
  return baseName === '.env' || baseName.startsWith('.env.')
}

function isCredentialsFile(baseName: string): boolean {
  return baseName.startsWith('credentials.')
}

function isSecretFile(pathName: string): boolean {
  return pathName.includes('secret')
}

function isMigrationFile(pathName: string, baseName: string): boolean {
  return pathName.includes('/migrations/') || pathName.includes('/migration/') || baseName.includes('migration')
}

function normalizeExtension(baseName: string): string {
  if (isEnvFile(baseName)) return '.env'
  const ext = path.posix.extname(baseName)
  if (ext) return ext
  return '(no-ext)'
}

function bumpExtension(counter: Record<string, number>, ext: string): void {
  counter[ext] = (counter[ext] ?? 0) + 1
}

// Cache functions
async function loadCache(cachePath: string): Promise<PRCache | null> {
  try {
    // Verify file permissions before reading to prevent tampering
    const stats = await fs.stat(cachePath)
    if ((stats.mode & 0o077) !== 0) {
      core.warning('Cache file has insecure permissions, ignoring')
      return null
    }
    const content = await fs.readFile(cachePath, 'utf8')
    let cache: PRCache
    try {
      cache = JSON.parse(content) as PRCache
    } catch {
      core.warning('Cache file corrupted, ignoring')
      return null
    }
    if (cache.version !== CACHE_VERSION) {
      core.info(`Cache version mismatch (expected ${CACHE_VERSION}, got ${cache.version}), ignoring cache`)
      return null
    }

    // Re-mask commit messages in case of legacy unmasked data
    for (const entry of Object.values(cache.entries)) {
      if (entry.data.commits) {
        entry.data.commits = entry.data.commits.map((commit) => ({
          sha: commit.sha,
          message: maskSensitive(commit.message).masked,
        }))
      }
    }

    return cache
  } catch {
    return null
  }
}

async function saveCache(cachePath: string, cache: PRCache): Promise<boolean> {
  try {
    await fs.mkdir(path.dirname(cachePath), { recursive: true, mode: 0o700 })
    await fs.writeFile(cachePath, `${JSON.stringify(cache, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    })
    return true
  } catch (error) {
    core.warning(`Failed to save cache: ${error instanceof Error ? error.message : 'unknown error'}`)
    return false
  }
}

function isCacheValid(entry: PRCacheEntry, updatedAt: string, headSha: string): boolean {
  return entry.updatedAt === updatedAt && entry.headSha === headSha
}

function getCacheSize(cache: PRCache): number {
  return Buffer.byteLength(JSON.stringify(cache), 'utf8')
}

function cleanupCache(cache: PRCache, validPrNumbers: Set<number>): PRCache {
  // First, exclude entries not included in the current release PR
  let entries = Object.entries(cache.entries).filter(([key]) => validPrNumbers.has(Number(key)))

  // Sort by cachedAt (newest first)
  entries.sort((a, b) => {
    const timeA = new Date(a[1].cachedAt).getTime()
    const timeB = new Date(b[1].cachedAt).getTime()
    return timeB - timeA
  })

  // If entry count exceeds limit, delete oldest entries
  if (entries.length > MAX_CACHE_ENTRIES) {
    entries = entries.slice(0, MAX_CACHE_ENTRIES)
  }

  // Size limit check (delete oldest first)
  let tempCache: PRCache = {
    version: CACHE_VERSION,
    generatedAt: new Date().toISOString(),
    entries: Object.fromEntries(entries.map(([key, entry]) => [Number(key), entry])),
  }

  /* c8 ignore start - cache size limit (100MB) is difficult to test without large mock data */
  while (entries.length > 0 && getCacheSize(tempCache) > MAX_CACHE_SIZE_BYTES) {
    entries.pop() // Delete the oldest entry
    tempCache = {
      ...tempCache,
      entries: Object.fromEntries(entries.map(([key, entry]) => [Number(key), entry])),
    }
  }
  /* c8 ignore stop */

  return tempCache
}

interface FileAnalysisResult {
  hasEnvFiles: boolean
  hasCredentialFiles: boolean
  hasSecretFiles: boolean
  hasMigrationFiles: boolean
}

function analyzeFile(filename: string, extensionCounts: Record<string, number>): FileAnalysisResult {
  const lowerPath = filename.toLowerCase()
  const baseName = path.posix.basename(lowerPath)

  const envFile = isEnvFile(baseName)
  const credentialsFile = isCredentialsFile(baseName)
  const secretFile = isSecretFile(lowerPath)
  const migrationFile = isMigrationFile(lowerPath, baseName)

  if (!envFile && !credentialsFile && !secretFile) {
    bumpExtension(extensionCounts, normalizeExtension(baseName))
  }

  return {
    hasEnvFiles: envFile,
    hasCredentialFiles: credentialsFile,
    hasSecretFiles: secretFile,
    hasMigrationFiles: migrationFile,
  }
}

function mergeFileAnalysis(
  target: { hasEnvFiles: boolean; hasCredentialFiles: boolean; hasSecretFiles: boolean; hasMigrationFiles: boolean },
  result: FileAnalysisResult,
): void {
  if (result.hasEnvFiles) target.hasEnvFiles = true
  if (result.hasCredentialFiles) target.hasCredentialFiles = true
  if (result.hasSecretFiles) target.hasSecretFiles = true
  if (result.hasMigrationFiles) target.hasMigrationFiles = true
}

interface ProcessPRCacheHitParams {
  cachedEntry: PRCacheEntry
  extensionCounts: Record<string, number>
  commitMessages: Set<string>
  fileFlags: { hasEnvFiles: boolean; hasCredentialFiles: boolean; hasSecretFiles: boolean; hasMigrationFiles: boolean }
}

interface ProcessPRCacheHitResult {
  detail: PullRequestDetail
  additions: number
  deletions: number
  changedFiles: number
}

function processPRCacheHit(prNum: number, params: ProcessPRCacheHitParams): ProcessPRCacheHitResult {
  const { cachedEntry, extensionCounts, commitMessages, fileFlags } = params
  const { data } = cachedEntry

  for (const filename of data.files) {
    const result = analyzeFile(filename, extensionCounts)
    mergeFileAnalysis(fileFlags, result)
  }

  for (const commit of data.commits) {
    const message = commit.message.split('\n')[0]?.trim()
    if (message) {
      commitMessages.add(maskSensitive(message).masked)
    }
  }

  return {
    detail: {
      number: prNum,
      title: data.title,
      author: data.author,
      labels: data.labels,
      url: data.url,
      description: data.description,
      additions: data.additions,
      deletions: data.deletions,
      changedFiles: data.changedFiles,
    },
    additions: data.additions,
    deletions: data.deletions,
    changedFiles: data.changedFiles,
  }
}

interface FilesProcessResult {
  files: string[]
}

async function processFilesForPR(
  client: GitHubClient,
  prNum: number,
  extensionCounts: Record<string, number>,
  fileFlags: { hasEnvFiles: boolean; hasCredentialFiles: boolean; hasSecretFiles: boolean; hasMigrationFiles: boolean },
): Promise<FilesProcessResult> {
  const filesResponse = await client.getPullRequestFiles(prNum)
  const files: string[] = []
  for (const file of filesResponse) {
    if (!file.filename) continue
    files.push(file.filename)
    const result = analyzeFile(file.filename, extensionCounts)
    mergeFileAnalysis(fileFlags, result)
  }
  return { files }
}

async function processCommitsForPR(
  client: GitHubClient,
  prNum: number,
  commitMessages: Set<string>,
): Promise<CommitInfo[]> {
  const commitsResponse = await client.getPullRequestCommits(prNum)
  const commits: CommitInfo[] = []
  for (const commit of commitsResponse) {
    const message = commit.commit?.message?.trim()
    const sha = (commit as { sha?: string }).sha || ''
    if (message && sha) {
      const maskedMessage = maskSensitive(message).masked
      commits.push({ sha, message: maskedMessage })
      const firstLine = maskedMessage.split('\n')[0]?.trim()
      if (firstLine) {
        commitMessages.add(firstLine)
      }
    }
  }
  return commits
}

function extractLabelNames(labels: Array<{ name?: string }>): string[] {
  return labels.map((label) => label.name).filter((name): name is string => typeof name === 'string' && name.length > 0)
}

function extractPRDescription(body: string | null | undefined): string | null {
  if (body && body.trim().length > 0) {
    return maskSensitive(body.trim()).masked
  }
  return null
}

interface ProcessPRCacheMissParams {
  client: GitHubClient
  prDetail: Awaited<ReturnType<GitHubClient['getPullRequest']>>
  extensionCounts: Record<string, number>
  commitMessages: Set<string>
  fileFlags: { hasEnvFiles: boolean; hasCredentialFiles: boolean; hasSecretFiles: boolean; hasMigrationFiles: boolean }
  cache: PRCache
  updatedAt: string
  headSha: string
}

interface ProcessPRCacheMissResult {
  detail: PullRequestDetail
  additions: number
  deletions: number
  changedFiles: number
}

async function processPRCacheMiss(prNum: number, params: ProcessPRCacheMissParams): Promise<ProcessPRCacheMissResult> {
  const { client, prDetail, extensionCounts, commitMessages, fileFlags, cache, updatedAt, headSha } = params

  const title = maskSensitive(prDetail.title || '').masked
  const author = prDetail.user?.login || 'unknown'
  const labels = Array.isArray(prDetail.labels) ? prDetail.labels : []
  const additions = typeof prDetail.additions === 'number' ? prDetail.additions : 0
  const deletions = typeof prDetail.deletions === 'number' ? prDetail.deletions : 0
  const changedFiles = typeof prDetail.changed_files === 'number' ? prDetail.changed_files : 0

  const { files } = await processFilesForPR(client, prNum, extensionCounts, fileFlags)
  const commits = await processCommitsForPR(client, prNum, commitMessages)
  const description = extractPRDescription(prDetail.body)
  const labelNames = extractLabelNames(labels)

  cache.entries[prNum] = {
    number: prNum,
    updatedAt,
    headSha,
    data: {
      title,
      author,
      labels: labelNames,
      url: prDetail.html_url,
      description,
      additions,
      deletions,
      changedFiles,
      files,
      commits,
    },
    cachedAt: new Date().toISOString(),
  }

  return {
    detail: {
      number: prNum,
      title,
      author,
      labels: labelNames,
      url: prDetail.html_url,
      description,
      additions,
      deletions,
      changedFiles,
    },
    additions,
    deletions,
    changedFiles,
  }
}

/**
 * Extract PR numbers from merge commits between base and head
 */
async function extractPullRequestNumbers(
  client: GitHubClient,
  base: string,
  head: string,
  includeSquashed: boolean,
): Promise<number[]> {
  const comparison = await client.compareCommits(base, head)

  // Warn if GitHub Compare API 250 commit limit is reached
  if (comparison.total_commits > comparison.commits.length) {
    core.warning(
      `GitHub Compare API returned ${comparison.commits.length} commits, ` +
        `but total is ${comparison.total_commits}. Some PRs may be missing.`,
    )
  }

  const prNumbers = new Set<number>()

  for (const commit of comparison.commits) {
    const message = commit.commit.message

    // Extract PR number from merge commit message
    // Example: "Merge pull request #123 from ..."
    const mergeMatch = message.match(/Merge pull request #(\d+)/)
    if (mergeMatch) {
      prNumbers.add(Number(mergeMatch[1]))
      continue
    }

    // If squashed option is enabled, also detect squash merge commits
    // Example patterns:
    // - "feat: add feature (#123)"
    // - "fix: bug fix (#456)"
    // - "Add new feature (owner/repo#123)"
    // NOT matched (issue references with keywords):
    // - "fix: bug (fixes #123)"
    // - "docs: update (relates to #789)"
    if (includeSquashed) {
      // Match "(#123)" or "(owner/repo#123)" or "(owner.name/repo.name#123)" at the end of first line
      // Strict pattern: only matches PR reference format, not keyword-prefixed issue refs
      const firstLine = message.split('\n')[0] || ''
      const squashMatch = firstLine.match(/\((?:[\w.-]+\/[\w.-]+)?#(\d+)\)\s*$/)
      if (squashMatch) {
        prNumbers.add(Number(squashMatch[1]))
      }
    }
  }

  return Array.from(prNumbers).sort((a, b) => a - b)
}

export interface CollectMetadataOptions {
  baseBranch: string
  headBranch: string
  outputPath?: string
  cachePath?: string
  includeSquashed?: boolean
  client?: GitHubClient
}

export interface CollectMetadataResult {
  metadata: ReleaseMetadata
  existingPrNumber?: number
  prNumbers: number[]
}

export async function collectMetadata(options: CollectMetadataOptions): Promise<CollectMetadataResult> {
  const {
    baseBranch,
    headBranch,
    outputPath = '.smart-pr-release/metadata.json',
    cachePath = '.smart-pr-release/cache/pr-cache.json',
    includeSquashed = false,
  } = options
  const client = options.client || createGitHubClientFromEnv()

  core.info(`Collecting metadata: ${headBranch} -> ${baseBranch}`)

  // Check for existing release PR
  const existingPRs = await client.findOpenPullRequest(baseBranch, headBranch)
  let existingPrNumber: number | undefined
  if (existingPRs.length > 0 && existingPRs[0]) {
    existingPrNumber = existingPRs[0].number
    core.info(`Found existing release PR: #${existingPrNumber}`)
  } else {
    core.info('No existing release PR found')
  }

  // Extract PRs from merge commits between branches
  core.info(`Extracting PRs from commits... (includeSquashed: ${includeSquashed})`)
  const prNumbers = await extractPullRequestNumbers(client, baseBranch, headBranch, includeSquashed)
  core.info(`Found ${prNumbers.length} PRs in diff`)

  if (prNumbers.length === 0) {
    core.warning('No pull requests found between branches.')
  }

  // Load existing cache
  const existingCache = await loadCache(cachePath)
  let cache: PRCache
  if (existingCache) {
    cache = existingCache
    core.info(`Loaded cache with ${Object.keys(cache.entries).length} entries`)
  } else {
    cache = {
      version: CACHE_VERSION,
      generatedAt: new Date().toISOString(),
      entries: {},
    }
    core.info('No existing cache found, starting fresh')
  }

  // Track valid PR numbers for cache cleanup
  const validPrNumbers = new Set(prNumbers)

  // Collect statistics
  const extensionCounts: Record<string, number> = {}
  const commitMessages = new Set<string>()
  let totalAdditions = 0
  let totalDeletions = 0
  let totalChangedFiles = 0
  const fileFlags = {
    hasEnvFiles: false,
    hasCredentialFiles: false,
    hasSecretFiles: false,
    hasMigrationFiles: false,
  }

  // Track cache stats
  let cacheHits = 0
  let cacheMisses = 0

  // Collect details for each PR
  const detailedPrs: PullRequestDetail[] = await Promise.all(
    prNumbers.map(async (prNum) => {
      const prDetail = await client.getPullRequest(prNum)
      const updatedAt = prDetail.updated_at || ''
      const headSha = prDetail.head?.sha || ''

      const cachedEntry = cache.entries[prNum]
      if (cachedEntry && isCacheValid(cachedEntry, updatedAt, headSha)) {
        cacheHits++
        core.info(`  PR #${prNum}: cache hit`)

        const result = processPRCacheHit(prNum, { cachedEntry, extensionCounts, commitMessages, fileFlags })
        totalAdditions += result.additions
        totalDeletions += result.deletions
        totalChangedFiles += result.changedFiles
        return result.detail
      }

      cacheMisses++
      core.info(`  PR #${prNum}: cache miss, fetching details`)

      const result = await processPRCacheMiss(prNum, {
        client,
        prDetail,
        extensionCounts,
        commitMessages,
        fileFlags,
        cache,
        updatedAt,
        headSha,
      })
      totalAdditions += result.additions
      totalDeletions += result.deletions
      totalChangedFiles += result.changedFiles
      return result.detail
    }),
  )

  core.info(`Cache stats: ${cacheHits} hits, ${cacheMisses} misses`)

  // Cleanup cache (remove PRs no longer in release + enforce max entries)
  const entriesBeforeCleanup = Object.keys(cache.entries).length
  cache = cleanupCache(cache, validPrNumbers)
  const entriesAfterCleanup = Object.keys(cache.entries).length
  const removedCount = entriesBeforeCleanup - entriesAfterCleanup
  if (removedCount > 0) {
    core.info(`Cache cleanup: removed ${removedCount} stale entries`)
  }

  // Save updated cache
  const saved = await saveCache(cachePath, cache)
  if (saved) {
    const sizeKB = Math.round(getCacheSize(cache) / 1024)
    core.info(
      `Cache saved: ${entriesAfterCleanup} entries, ${sizeKB}KB (limits: ${MAX_CACHE_ENTRIES} entries, ${MAX_CACHE_SIZE_BYTES / 1024 / 1024}MB)`,
    )
  }

  const stats: ReleaseStats = {
    totalAdditions,
    totalDeletions,
    totalChangedFiles,
    extensionCounts,
    commitMessages: [...commitMessages],
    hasEnvFiles: fileFlags.hasEnvFiles,
    hasCredentialFiles: fileFlags.hasCredentialFiles,
    hasSecretFiles: fileFlags.hasSecretFiles,
    hasMigrationFiles: fileFlags.hasMigrationFiles,
  }

  const metadata: ReleaseMetadata = {
    generatedAt: new Date().toISOString(),
    releasePr: existingPrNumber
      ? {
          number: existingPrNumber,
          title: 'Release PR',
          base: baseBranch,
          head: headBranch,
          url: '',
        }
      : undefined,
    baseBranch,
    headBranch,
    prs: detailedPrs,
    stats,
  }

  // Write output with restricted permissions
  await fs.mkdir(path.dirname(outputPath), { recursive: true, mode: 0o700 })
  await fs.writeFile(outputPath, `${JSON.stringify(metadata, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  })

  core.info(`Release metadata written to ${outputPath}`)
  core.info(`Stats: +${totalAdditions} -${totalDeletions} / ${totalChangedFiles} files`)

  return { metadata, existingPrNumber, prNumbers }
}

export async function run(ctx: RunContext = createDefaultContext(), deps?: RunDeps): Promise<void> {
  const resolvedDeps = deps ?? (await createDefaultDeps())
  try {
    const baseBranch = ctx.env.RELEASE_BASE || 'production'
    const headBranch = ctx.env.RELEASE_HEAD || 'main'
    const includeSquashed = ctx.env.RELEASE_INCLUDE_SQUASHED === 'true'

    // Use GITHUB_WORKSPACE as base directory when running in GitHub Actions
    // This ensures paths are resolved relative to the caller repository, not the action repository
    const baseDir = ctx.env.GITHUB_WORKSPACE || ctx.cwd()
    const outputPathRaw = ctx.env.RELEASE_METADATA_PATH || '.smart-pr-release/metadata.json'
    const cachePathRaw = ctx.env.RELEASE_CACHE_PATH || '.smart-pr-release/cache/pr-cache.json'

    // Validate paths to prevent path traversal attacks
    const outputPath = await validatePath(outputPathRaw, baseDir)
    const cachePath = await validatePath(cachePathRaw, baseDir)

    const client = createGitHubClientFromEnv()

    const result = await collectMetadata({
      baseBranch,
      headBranch,
      outputPath,
      cachePath,
      includeSquashed,
      client,
    })

    // Output existing PR number if found
    if (result.existingPrNumber) {
      resolvedDeps.core.setOutput('existing_pr_number', String(result.existingPrNumber))
    } else {
      resolvedDeps.core.setOutput('existing_pr_number', '')
    }

    // Output list of PR numbers
    resolvedDeps.core.setOutput('pr_numbers', result.prNumbers.join(','))
  } catch (error) {
    if (error instanceof Error) {
      resolvedDeps.core.setFailed(error.message)
    } else {
      resolvedDeps.core.setFailed('An unexpected error occurred')
    }
  }
}

/* c8 ignore start - production entry point */
if (process.env.GITHUB_ACTIONS === 'true') {
  run()
}
/* c8 ignore stop */
