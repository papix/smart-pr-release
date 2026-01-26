import * as fs from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RunContext, RunDeps } from '#core/cli-types.js'
import { collectMetadata, run } from './index.js'

// Mock @actions/core
vi.mock('@actions/core', () => ({
  info: vi.fn(),
  warning: vi.fn(),
  setOutput: vi.fn(),
  setFailed: vi.fn(),
}))

// Mock #core/github-api.js with hoisted mock
const { mockCreateGitHubClientFromEnv } = vi.hoisted(() => ({
  mockCreateGitHubClientFromEnv: vi.fn(),
}))

vi.mock(import('#core/github-api.js'), () => ({
  createGitHubClientFromEnv: mockCreateGitHubClientFromEnv,
}))

// Mock fs
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
  stat: vi.fn(),
  lstat: vi.fn(),
}))

describe('smart-pr-release-collect', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(fs.mkdir).mockResolvedValue(undefined)
    vi.mocked(fs.writeFile).mockResolvedValue(undefined)
    // Default to secure permissions (0o600)
    vi.mocked(fs.stat).mockResolvedValue({ mode: 0o100600 } as fs.FileHandle & { mode: number })
    // Default lstat: first call (baseDir check) returns non-symlink, subsequent calls return ENOENT
    const enoentError = Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    vi.mocked(fs.lstat).mockImplementation(async (pathArg) => {
      // For baseDir check (first segment), return a regular directory
      const pathStr = String(pathArg)
      if (pathStr === '/test' || pathStr === '/custom/path' || pathStr.endsWith('/smart-pr-release')) {
        return { isSymbolicLink: () => false } as fs.Stats
      }
      // For other paths, throw ENOENT
      throw enoentError
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('collectMetadata', () => {
    const createMockClient = (overrides: Partial<Record<string, unknown>> = {}) => ({
      findOpenPullRequest: vi.fn().mockResolvedValue([]),
      compareCommits: vi.fn().mockResolvedValue({
        commits: [
          { commit: { message: 'Merge pull request #1 from test/feature1' } },
          { commit: { message: 'Merge pull request #2 from test/feature2' } },
        ],
      }),
      getPullRequest: vi.fn().mockImplementation((num: number) => {
        return Promise.resolve({
          number: num,
          title: `PR ${num}`,
          body: `Description for PR ${num}`,
          html_url: `https://github.com/test/pr/${num}`,
          labels: [{ name: 'enhancement' }],
          user: { login: `user${num}` },
          additions: 50,
          deletions: 10,
          changed_files: 5,
          updated_at: '2024-01-15T10:00:00Z',
          head: { sha: `sha${num}` },
        })
      }),
      getPullRequestFiles: vi.fn().mockResolvedValue([{ filename: 'src/index.ts' }, { filename: 'src/utils.ts' }]),
      getPullRequestCommits: vi.fn().mockResolvedValue([
        { sha: 'abc123', commit: { message: 'Initial commit' } },
        { sha: 'def456', commit: { message: 'Add tests' } },
      ]),
      ...overrides,
    })

    it('collects metadata from branch comparison', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('File not found'))

      const mockClient = createMockClient()
      const result = await collectMetadata({
        baseBranch: 'production',
        headBranch: 'main',
        outputPath: '/tmp/metadata.json',
        cachePath: '/tmp/cache.json',
        client: mockClient as never,
      })

      expect(result.prNumbers).toEqual([1, 2])
      expect(result.metadata.prs).toHaveLength(2)
      expect(result.metadata.baseBranch).toBe('production')
      expect(result.metadata.headBranch).toBe('main')
    })

    it('returns existing PR number when found', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('File not found'))

      const mockClient = createMockClient({
        findOpenPullRequest: vi.fn().mockResolvedValue([{ number: 123 }]),
      })
      const result = await collectMetadata({
        baseBranch: 'production',
        headBranch: 'main',
        outputPath: '/tmp/metadata.json',
        cachePath: '/tmp/cache.json',
        client: mockClient as never,
      })

      expect(result.existingPrNumber).toBe(123)
    })

    it('returns undefined when no existing PR', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('File not found'))

      const mockClient = createMockClient({
        findOpenPullRequest: vi.fn().mockResolvedValue([]),
      })
      const result = await collectMetadata({
        baseBranch: 'production',
        headBranch: 'main',
        outputPath: '/tmp/metadata.json',
        cachePath: '/tmp/cache.json',
        client: mockClient as never,
      })

      expect(result.existingPrNumber).toBeUndefined()
    })

    it('extracts PR numbers from merge commits', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('File not found'))

      const mockClient = createMockClient({
        compareCommits: vi.fn().mockResolvedValue({
          commits: [
            { commit: { message: 'Merge pull request #10 from test/feature' } },
            { commit: { message: 'Merge pull request #20 from test/other' } },
            { commit: { message: 'Regular commit without PR' } },
          ],
        }),
      })

      const result = await collectMetadata({
        baseBranch: 'production',
        headBranch: 'main',
        outputPath: '/tmp/metadata.json',
        cachePath: '/tmp/cache.json',
        client: mockClient as never,
      })

      expect(result.prNumbers).toEqual([10, 20])
    })

    it('handles empty PR list', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('File not found'))

      const mockClient = createMockClient({
        compareCommits: vi.fn().mockResolvedValue({
          commits: [{ commit: { message: 'Regular commit' } }],
        }),
      })

      const result = await collectMetadata({
        baseBranch: 'production',
        headBranch: 'main',
        outputPath: '/tmp/metadata.json',
        cachePath: '/tmp/cache.json',
        client: mockClient as never,
      })

      expect(result.prNumbers).toEqual([])
      expect(result.metadata.prs).toHaveLength(0)
    })

    it('warns when Compare API 250 commit limit is reached', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('File not found'))

      const mockClient = createMockClient({
        compareCommits: vi.fn().mockResolvedValue({
          total_commits: 300,
          commits: Array(250)
            .fill(null)
            .map((_, i) => ({
              commit: { message: i === 0 ? 'Merge pull request #1 from test/feature' : `Commit ${i}` },
            })),
        }),
      })

      const core = await import('@actions/core')

      await collectMetadata({
        baseBranch: 'production',
        headBranch: 'main',
        outputPath: '/tmp/metadata.json',
        cachePath: '/tmp/cache.json',
        client: mockClient as never,
      })

      expect(core.warning).toHaveBeenCalledWith(
        'GitHub Compare API returned 250 commits, but total is 300. Some PRs may be missing.',
      )
    })

    it('uses cached data when valid', async () => {
      const cacheData = {
        version: 1,
        generatedAt: '2024-01-15T09:00:00Z',
        entries: {
          1: {
            number: 1,
            updatedAt: '2024-01-15T10:00:00Z',
            headSha: 'sha1',
            data: {
              title: 'Cached PR 1',
              author: 'cachedUser',
              labels: ['cached'],
              url: 'https://github.com/test/pr/1',
              description: 'Cached description',
              additions: 100,
              deletions: 20,
              changedFiles: 10,
              files: ['src/cached.ts'],
              commits: [{ sha: 'cached123', message: 'Cached commit' }],
            },
            cachedAt: '2024-01-15T09:30:00Z',
          },
        },
      }

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(cacheData))

      const mockClient = createMockClient()
      const result = await collectMetadata({
        baseBranch: 'production',
        headBranch: 'main',
        outputPath: '/tmp/metadata.json',
        cachePath: '/tmp/cache.json',
        client: mockClient as never,
      })

      // PR #1 should use cached data
      const pr1 = result.metadata.prs.find((pr) => pr.number === 1)
      expect(pr1?.title).toBe('Cached PR 1')
      expect(pr1?.author).toBe('cachedUser')
    })

    it('ignores cache with insecure permissions', async () => {
      const cacheData = {
        version: 1,
        generatedAt: '2024-01-15T09:00:00Z',
        entries: {
          1: {
            number: 1,
            updatedAt: '2024-01-15T10:00:00Z',
            headSha: 'sha1',
            data: {
              title: 'Cached PR 1',
              author: 'cachedUser',
              labels: ['cached'],
              url: 'https://github.com/test/pr/1',
              description: 'Cached description',
              additions: 100,
              deletions: 20,
              changedFiles: 10,
              files: ['src/cached.ts'],
              commits: [{ sha: 'cached123', message: 'Cached commit' }],
            },
            cachedAt: '2024-01-15T09:30:00Z',
          },
        },
      }

      // Set insecure permissions (world-readable: 0o644)
      vi.mocked(fs.stat).mockResolvedValue({ mode: 0o100644 } as fs.FileHandle & { mode: number })
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(cacheData))

      const mockClient = createMockClient()
      const result = await collectMetadata({
        baseBranch: 'production',
        headBranch: 'main',
        outputPath: '/tmp/metadata.json',
        cachePath: '/tmp/cache.json',
        client: mockClient as never,
      })

      // PR #1 should fetch fresh data since cache has insecure permissions
      const pr1 = result.metadata.prs.find((pr) => pr.number === 1)
      expect(pr1?.title).toBe('PR 1') // From API, not cache
    })

    it('invalidates cache when updatedAt changes', async () => {
      const cacheData = {
        version: 1,
        generatedAt: '2024-01-15T09:00:00Z',
        entries: {
          1: {
            number: 1,
            updatedAt: '2024-01-14T10:00:00Z', // Different from mock response
            headSha: 'sha1',
            data: {
              title: 'Old cached title',
              author: 'oldUser',
              labels: [],
              url: 'https://github.com/test/pr/1',
              description: null,
              additions: 10,
              deletions: 5,
              changedFiles: 2,
              files: [],
              commits: [],
            },
            cachedAt: '2024-01-14T10:00:00Z',
          },
        },
      }

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(cacheData))

      const mockClient = createMockClient()
      const result = await collectMetadata({
        baseBranch: 'production',
        headBranch: 'main',
        outputPath: '/tmp/metadata.json',
        cachePath: '/tmp/cache.json',
        client: mockClient as never,
      })

      // PR #1 should fetch fresh data since cache is invalid
      const pr1 = result.metadata.prs.find((pr) => pr.number === 1)
      expect(pr1?.title).toBe('PR 1') // From API, not cache
    })

    it('ignores cache with mismatched version', async () => {
      const cacheData = {
        version: 999, // Wrong version
        generatedAt: '2024-01-15T09:00:00Z',
        entries: {},
      }

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(cacheData))

      const mockClient = createMockClient()
      await collectMetadata({
        baseBranch: 'production',
        headBranch: 'main',
        outputPath: '/tmp/metadata.json',
        cachePath: '/tmp/cache.json',
        client: mockClient as never,
      })

      // Should fetch fresh data since cache version is wrong
      expect(mockClient.getPullRequestFiles).toHaveBeenCalled()
    })

    it('detects env files', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('File not found'))

      const mockClient = createMockClient({
        getPullRequestFiles: vi
          .fn()
          .mockResolvedValue([{ filename: '.env' }, { filename: '.env.local' }, { filename: 'src/index.ts' }]),
      })

      const result = await collectMetadata({
        baseBranch: 'production',
        headBranch: 'main',
        outputPath: '/tmp/metadata.json',
        cachePath: '/tmp/cache.json',
        client: mockClient as never,
      })

      expect(result.metadata.stats.hasEnvFiles).toBe(true)
    })

    it('detects credential files', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('File not found'))

      const mockClient = createMockClient({
        getPullRequestFiles: vi
          .fn()
          .mockResolvedValue([{ filename: 'credentials.json' }, { filename: 'src/index.ts' }]),
      })

      const result = await collectMetadata({
        baseBranch: 'production',
        headBranch: 'main',
        outputPath: '/tmp/metadata.json',
        cachePath: '/tmp/cache.json',
        client: mockClient as never,
      })

      expect(result.metadata.stats.hasCredentialFiles).toBe(true)
    })

    it('detects secret files', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('File not found'))

      const mockClient = createMockClient({
        getPullRequestFiles: vi
          .fn()
          .mockResolvedValue([{ filename: 'config/secrets/api-key.txt' }, { filename: 'src/index.ts' }]),
      })

      const result = await collectMetadata({
        baseBranch: 'production',
        headBranch: 'main',
        outputPath: '/tmp/metadata.json',
        cachePath: '/tmp/cache.json',
        client: mockClient as never,
      })

      expect(result.metadata.stats.hasSecretFiles).toBe(true)
    })

    it('detects migration files', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('File not found'))

      const mockClient = createMockClient({
        getPullRequestFiles: vi
          .fn()
          .mockResolvedValue([{ filename: 'db/migrations/001_create_users.sql' }, { filename: 'src/index.ts' }]),
      })

      const result = await collectMetadata({
        baseBranch: 'production',
        headBranch: 'main',
        outputPath: '/tmp/metadata.json',
        cachePath: '/tmp/cache.json',
        client: mockClient as never,
      })

      expect(result.metadata.stats.hasMigrationFiles).toBe(true)
    })

    it('counts file extensions', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('File not found'))

      const mockClient = createMockClient({
        getPullRequestFiles: vi.fn().mockResolvedValue([
          { filename: 'src/index.ts' },
          { filename: 'src/utils.ts' },
          { filename: 'src/components/Button.tsx' },
          { filename: 'README.md' },
          { filename: 'Makefile' }, // No extension
        ]),
      })

      const result = await collectMetadata({
        baseBranch: 'production',
        headBranch: 'main',
        outputPath: '/tmp/metadata.json',
        cachePath: '/tmp/cache.json',
        client: mockClient as never,
      })

      // Each PR has same files, so multiply by 2
      expect(result.metadata.stats.extensionCounts['.ts']).toBe(4)
      expect(result.metadata.stats.extensionCounts['.tsx']).toBe(2)
      expect(result.metadata.stats.extensionCounts['.md']).toBe(2)
      expect(result.metadata.stats.extensionCounts['(no-ext)']).toBe(2)
    })

    it('collects commit messages', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('File not found'))

      const mockClient = createMockClient({
        getPullRequestCommits: vi.fn().mockResolvedValue([
          { sha: 'abc', commit: { message: 'feat: add new feature\n\nDetailed description' } },
          { sha: 'def', commit: { message: 'fix: resolve bug' } },
        ]),
      })

      const result = await collectMetadata({
        baseBranch: 'production',
        headBranch: 'main',
        outputPath: '/tmp/metadata.json',
        cachePath: '/tmp/cache.json',
        client: mockClient as never,
      })

      expect(result.metadata.stats.commitMessages).toContain('feat: add new feature')
      expect(result.metadata.stats.commitMessages).toContain('fix: resolve bug')
    })

    it('handles PR without user info', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('File not found'))

      const mockClient = createMockClient({
        getPullRequest: vi.fn().mockImplementation((num: number) => {
          return Promise.resolve({
            number: num,
            title: `PR ${num}`,
            body: 'Description',
            html_url: `https://github.com/test/pr/${num}`,
            labels: [],
            user: null, // No user
            additions: 10,
            deletions: 5,
            changed_files: 2,
            updated_at: '2024-01-15T10:00:00Z',
            head: { sha: 'testsha' },
          })
        }),
      })

      const result = await collectMetadata({
        baseBranch: 'production',
        headBranch: 'main',
        outputPath: '/tmp/metadata.json',
        cachePath: '/tmp/cache.json',
        client: mockClient as never,
      })

      // Should fall back to 'unknown'
      expect(result.metadata.prs[0]?.author).toBe('unknown')
    })

    it('handles cache save failure gracefully', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('File not found'))
      // Make cache write fail but metadata write succeed
      vi.mocked(fs.writeFile).mockImplementation(async (filePath) => {
        if (typeof filePath === 'string' && filePath.includes('cache')) {
          throw new Error('Cache write failed')
        }
        return undefined
      })

      const mockClient = createMockClient()

      // Should not throw even if cache save fails
      const result = await collectMetadata({
        baseBranch: 'production',
        headBranch: 'main',
        outputPath: '/tmp/metadata.json',
        cachePath: '/tmp/cache.json',
        client: mockClient as never,
      })

      expect(result.metadata.prs).toHaveLength(2)
    })

    it('cleans up stale cache entries', async () => {
      const cacheData = {
        version: 1,
        generatedAt: '2024-01-15T09:00:00Z',
        entries: {
          1: {
            number: 1,
            updatedAt: '2024-01-15T10:00:00Z',
            headSha: 'sha1',
            data: {
              title: 'PR 1',
              author: 'user1',
              labels: [],
              url: 'https://github.com/test/pr/1',
              description: null,
              additions: 10,
              deletions: 5,
              changedFiles: 2,
              files: ['src/a.ts'],
              commits: [],
            },
            cachedAt: '2024-01-15T09:30:00Z',
          },
          999: {
            // This PR is not in the release anymore
            number: 999,
            updatedAt: '2024-01-10T10:00:00Z',
            headSha: 'oldsha',
            data: {
              title: 'Old PR',
              author: 'olduser',
              labels: [],
              url: 'https://github.com/test/pr/999',
              description: null,
              additions: 5,
              deletions: 2,
              changedFiles: 1,
              files: [],
              commits: [],
            },
            cachedAt: '2024-01-10T09:30:00Z',
          },
        },
      }

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(cacheData))

      const mockClient = createMockClient()
      await collectMetadata({
        baseBranch: 'production',
        headBranch: 'main',
        outputPath: '/tmp/metadata.json',
        cachePath: '/tmp/cache.json',
        client: mockClient as never,
      })

      // Verify cache was written with stale entry removed
      const writeCalls = vi.mocked(fs.writeFile).mock.calls
      const cacheWriteCall = writeCalls.find((call) => typeof call[0] === 'string' && call[0].includes('cache'))
      expect(cacheWriteCall).toBeDefined()

      const writtenCache = JSON.parse(cacheWriteCall?.[1] as string)
      expect(writtenCache.entries[999]).toBeUndefined()
    })

    it('handles file without filename in response', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('File not found'))

      const mockClient = createMockClient({
        getPullRequestFiles: vi.fn().mockResolvedValue([
          { filename: 'src/index.ts' },
          { filename: undefined }, // Missing filename
          { filename: '' }, // Empty filename
        ]),
      })

      const result = await collectMetadata({
        baseBranch: 'production',
        headBranch: 'main',
        outputPath: '/tmp/metadata.json',
        cachePath: '/tmp/cache.json',
        client: mockClient as never,
      })

      // Should skip files without filename
      expect(result.metadata.stats.extensionCounts['.ts']).toBe(2) // Only valid file counted
    })

    it('handles commit without message', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('File not found'))

      const mockClient = createMockClient({
        getPullRequestCommits: vi.fn().mockResolvedValue([
          { sha: 'abc', commit: { message: 'Valid message' } },
          { sha: 'def', commit: { message: '' } }, // Empty message
          { sha: 'ghi', commit: { message: null } }, // Null message
          { sha: '', commit: { message: 'No sha' } }, // Empty sha
        ]),
      })

      const result = await collectMetadata({
        baseBranch: 'production',
        headBranch: 'main',
        outputPath: '/tmp/metadata.json',
        cachePath: '/tmp/cache.json',
        client: mockClient as never,
      })

      expect(result.metadata.stats.commitMessages).toContain('Valid message')
    })

    it('handles .env extension in normalizeExtension', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('File not found'))

      const mockClient = createMockClient({
        getPullRequestFiles: vi.fn().mockResolvedValue([{ filename: '.env.production' }, { filename: 'src/index.ts' }]),
      })

      const result = await collectMetadata({
        baseBranch: 'production',
        headBranch: 'main',
        outputPath: '/tmp/metadata.json',
        cachePath: '/tmp/cache.json',
        client: mockClient as never,
      })

      // .env files should be flagged but not counted in extension stats
      expect(result.metadata.stats.hasEnvFiles).toBe(true)
      expect(result.metadata.stats.extensionCounts['.env']).toBeUndefined()
    })

    it('handles migration folder detection', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('File not found'))

      const mockClient = createMockClient({
        getPullRequestFiles: vi.fn().mockResolvedValue([{ filename: 'src/migration/001.ts' }]),
      })

      const result = await collectMetadata({
        baseBranch: 'production',
        headBranch: 'main',
        outputPath: '/tmp/metadata.json',
        cachePath: '/tmp/cache.json',
        client: mockClient as never,
      })

      expect(result.metadata.stats.hasMigrationFiles).toBe(true)
    })

    it('handles migration filename detection', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('File not found'))

      const mockClient = createMockClient({
        getPullRequestFiles: vi.fn().mockResolvedValue([{ filename: 'db/user_migration.sql' }]),
      })

      const result = await collectMetadata({
        baseBranch: 'production',
        headBranch: 'main',
        outputPath: '/tmp/metadata.json',
        cachePath: '/tmp/cache.json',
        client: mockClient as never,
      })

      expect(result.metadata.stats.hasMigrationFiles).toBe(true)
    })

    it('calculates totals correctly', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('File not found'))

      const mockClient = createMockClient({
        getPullRequest: vi.fn().mockImplementation((num: number) => {
          return Promise.resolve({
            number: num,
            title: `PR ${num}`,
            body: 'Description',
            html_url: `https://github.com/test/pr/${num}`,
            labels: [],
            user: { login: `user${num}` },
            additions: num * 10, // PR 1 = 10, PR 2 = 20
            deletions: num * 5, // PR 1 = 5, PR 2 = 10
            changed_files: num * 2, // PR 1 = 2, PR 2 = 4
            updated_at: '2024-01-15T10:00:00Z',
            head: { sha: `sha${num}` },
          })
        }),
      })

      const result = await collectMetadata({
        baseBranch: 'production',
        headBranch: 'main',
        outputPath: '/tmp/metadata.json',
        cachePath: '/tmp/cache.json',
        client: mockClient as never,
      })

      expect(result.metadata.stats.totalAdditions).toBe(30) // 10 + 20
      expect(result.metadata.stats.totalDeletions).toBe(15) // 5 + 10
      expect(result.metadata.stats.totalChangedFiles).toBe(6) // 2 + 4
    })

    it('uses cached data for stats calculation', async () => {
      const cacheData = {
        version: 1,
        generatedAt: '2024-01-15T09:00:00Z',
        entries: {
          1: {
            number: 1,
            updatedAt: '2024-01-15T10:00:00Z',
            headSha: 'sha1',
            data: {
              title: 'Cached PR',
              author: 'cachedUser',
              labels: [],
              url: 'https://github.com/test/pr/1',
              description: null,
              additions: 100,
              deletions: 50,
              changedFiles: 20,
              files: ['src/cached.ts', 'config/secret.json'],
              commits: [{ sha: 'c1', message: 'Cached commit message' }],
            },
            cachedAt: '2024-01-15T09:30:00Z',
          },
        },
      }

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(cacheData))

      const mockClient = createMockClient({
        compareCommits: vi.fn().mockResolvedValue({
          commits: [{ commit: { message: 'Merge pull request #1 from test/feature' } }],
        }),
      })

      const result = await collectMetadata({
        baseBranch: 'production',
        headBranch: 'main',
        outputPath: '/tmp/metadata.json',
        cachePath: '/tmp/cache.json',
        client: mockClient as never,
      })

      // Stats should come from cache
      expect(result.metadata.stats.totalAdditions).toBe(100)
      expect(result.metadata.stats.totalDeletions).toBe(50)
      expect(result.metadata.stats.totalChangedFiles).toBe(20)
      expect(result.metadata.stats.hasSecretFiles).toBe(true)
      expect(result.metadata.stats.commitMessages).toContain('Cached commit message')
    })

    it('re-masks sensitive data in legacy cache entries', async () => {
      // Cache contains unmasked sensitive data (legacy format)
      const cacheData = {
        version: 1,
        generatedAt: '2024-01-15T09:00:00Z',
        entries: {
          1: {
            number: 1,
            updatedAt: '2024-01-15T10:00:00Z',
            headSha: 'sha1',
            data: {
              title: 'PR 1',
              author: 'user1',
              labels: [],
              url: 'https://github.com/test/pr/1',
              description: null,
              additions: 10,
              deletions: 5,
              changedFiles: 2,
              files: ['src/a.ts'],
              // Unmasked sensitive data in commit message
              commits: [{ sha: 'abc', message: 'Add API_KEY=secret123 to config' }],
            },
            cachedAt: '2024-01-15T09:30:00Z',
          },
        },
      }

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(cacheData))

      const mockClient = createMockClient({
        compareCommits: vi.fn().mockResolvedValue({
          commits: [{ commit: { message: 'Merge pull request #1 from test/feature' } }],
        }),
      })

      const result = await collectMetadata({
        baseBranch: 'production',
        headBranch: 'main',
        outputPath: '/tmp/metadata.json',
        cachePath: '/tmp/cache.json',
        client: mockClient as never,
      })

      // The commit message should be re-masked
      expect(result.metadata.stats.commitMessages[0]).not.toContain('secret123')
      expect(result.metadata.stats.commitMessages[0]).toContain('[redacted]')
    })

    it('handles PR with empty body trimmed', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('File not found'))

      const mockClient = createMockClient({
        getPullRequest: vi.fn().mockImplementation((num: number) => {
          return Promise.resolve({
            number: num,
            title: `PR ${num}`,
            body: '   ', // Only whitespace
            html_url: `https://github.com/test/pr/${num}`,
            labels: [],
            user: { login: `user${num}` },
            additions: 10,
            deletions: 5,
            changed_files: 2,
            updated_at: '2024-01-15T10:00:00Z',
            head: { sha: `sha${num}` },
          })
        }),
      })

      const result = await collectMetadata({
        baseBranch: 'production',
        headBranch: 'main',
        outputPath: '/tmp/metadata.json',
        cachePath: '/tmp/cache.json',
        client: mockClient as never,
      })

      expect(result.metadata.prs[0]?.description).toBeNull()
    })

    it('handles undefined labels array', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('File not found'))

      const mockClient = createMockClient({
        getPullRequest: vi.fn().mockImplementation((num: number) => {
          return Promise.resolve({
            number: num,
            title: `PR ${num}`,
            body: 'Description',
            html_url: `https://github.com/test/pr/${num}`,
            labels: undefined, // Undefined labels
            user: { login: `user${num}` },
            additions: 10,
            deletions: 5,
            changed_files: 2,
            updated_at: '2024-01-15T10:00:00Z',
            head: { sha: `sha${num}` },
          })
        }),
      })

      const result = await collectMetadata({
        baseBranch: 'production',
        headBranch: 'main',
        outputPath: '/tmp/metadata.json',
        cachePath: '/tmp/cache.json',
        client: mockClient as never,
      })

      expect(result.metadata.prs[0]?.labels).toEqual([])
    })

    describe('squash merge detection', () => {
      it('extracts PR numbers from squash merge commits when includeSquashed is true', async () => {
        vi.mocked(fs.readFile).mockRejectedValue(new Error('File not found'))

        const mockClient = createMockClient({
          compareCommits: vi.fn().mockResolvedValue({
            commits: [
              { commit: { message: 'feat: add new feature (#10)' } },
              { commit: { message: 'fix: resolve bug (#20)' } },
              { commit: { message: 'Regular commit without PR' } },
            ],
          }),
        })

        const result = await collectMetadata({
          baseBranch: 'production',
          headBranch: 'main',
          outputPath: '/tmp/metadata.json',
          cachePath: '/tmp/cache.json',
          includeSquashed: true,
          client: mockClient as never,
        })

        expect(result.prNumbers).toEqual([10, 20])
      })

      it('does not extract squash merge PRs when includeSquashed is false', async () => {
        vi.mocked(fs.readFile).mockRejectedValue(new Error('File not found'))

        const mockClient = createMockClient({
          compareCommits: vi.fn().mockResolvedValue({
            commits: [
              { commit: { message: 'feat: add new feature (#10)' } },
              { commit: { message: 'fix: resolve bug (#20)' } },
            ],
          }),
        })

        const result = await collectMetadata({
          baseBranch: 'production',
          headBranch: 'main',
          outputPath: '/tmp/metadata.json',
          cachePath: '/tmp/cache.json',
          includeSquashed: false,
          client: mockClient as never,
        })

        expect(result.prNumbers).toEqual([])
      })

      it('extracts PR from cross-repo reference format', async () => {
        vi.mocked(fs.readFile).mockRejectedValue(new Error('File not found'))

        const mockClient = createMockClient({
          compareCommits: vi.fn().mockResolvedValue({
            commits: [{ commit: { message: 'feat: add feature (owner/repo#30)' } }],
          }),
        })

        const result = await collectMetadata({
          baseBranch: 'production',
          headBranch: 'main',
          outputPath: '/tmp/metadata.json',
          cachePath: '/tmp/cache.json',
          includeSquashed: true,
          client: mockClient as never,
        })

        expect(result.prNumbers).toEqual([30])
      })

      it('extracts PR from cross-repo reference with dots in owner/repo name', async () => {
        vi.mocked(fs.readFile).mockRejectedValue(new Error('File not found'))

        const mockClient = createMockClient({
          compareCommits: vi.fn().mockResolvedValue({
            commits: [{ commit: { message: 'feat: feature (owner.name/repo.test#456)' } }],
          }),
        })

        const result = await collectMetadata({
          baseBranch: 'production',
          headBranch: 'main',
          outputPath: '/tmp/metadata.json',
          cachePath: '/tmp/cache.json',
          includeSquashed: true,
          client: mockClient as never,
        })

        expect(result.prNumbers).toEqual([456])
      })

      it('handles both merge and squash commits together', async () => {
        vi.mocked(fs.readFile).mockRejectedValue(new Error('File not found'))

        const mockClient = createMockClient({
          compareCommits: vi.fn().mockResolvedValue({
            commits: [
              { commit: { message: 'Merge pull request #5 from test/feature' } },
              { commit: { message: 'feat: squashed feature (#15)' } },
              { commit: { message: 'Regular commit' } },
            ],
          }),
        })

        const result = await collectMetadata({
          baseBranch: 'production',
          headBranch: 'main',
          outputPath: '/tmp/metadata.json',
          cachePath: '/tmp/cache.json',
          includeSquashed: true,
          client: mockClient as never,
        })

        expect(result.prNumbers).toEqual([5, 15])
      })

      it('does not duplicate PR numbers from merge commits when squash is enabled', async () => {
        vi.mocked(fs.readFile).mockRejectedValue(new Error('File not found'))

        const mockClient = createMockClient({
          compareCommits: vi.fn().mockResolvedValue({
            commits: [
              { commit: { message: 'Merge pull request #10 from test/feature' } },
              { commit: { message: 'feat: related change (#10)' } }, // Same PR
            ],
          }),
        })

        const result = await collectMetadata({
          baseBranch: 'production',
          headBranch: 'main',
          outputPath: '/tmp/metadata.json',
          cachePath: '/tmp/cache.json',
          includeSquashed: true,
          client: mockClient as never,
        })

        expect(result.prNumbers).toEqual([10]) // Should not duplicate
      })

      it('ignores parentheses that do not match PR pattern', async () => {
        vi.mocked(fs.readFile).mockRejectedValue(new Error('File not found'))

        const mockClient = createMockClient({
          compareCommits: vi.fn().mockResolvedValue({
            commits: [
              { commit: { message: 'fix: handle edge case (JIRA-123)' } }, // Not a PR reference
              { commit: { message: 'docs: update readme (WIP)' } }, // Not a PR reference
            ],
          }),
        })

        const result = await collectMetadata({
          baseBranch: 'production',
          headBranch: 'main',
          outputPath: '/tmp/metadata.json',
          cachePath: '/tmp/cache.json',
          includeSquashed: true,
          client: mockClient as never,
        })

        expect(result.prNumbers).toEqual([])
      })

      it('ignores keyword-prefixed issue references', async () => {
        vi.mocked(fs.readFile).mockRejectedValue(new Error('File not found'))

        const mockClient = createMockClient({
          compareCommits: vi.fn().mockResolvedValue({
            commits: [
              { commit: { message: 'fix: bug (fixes #123)' } }, // Issue reference, not PR
              { commit: { message: 'docs: update (closes #456)' } }, // Issue reference, not PR
              { commit: { message: 'feat: add feature (relates to #789)' } }, // Issue reference, not PR
              { commit: { message: 'chore: cleanup (resolves #111)' } }, // Issue reference, not PR
            ],
          }),
        })

        const result = await collectMetadata({
          baseBranch: 'production',
          headBranch: 'main',
          outputPath: '/tmp/metadata.json',
          cachePath: '/tmp/cache.json',
          includeSquashed: true,
          client: mockClient as never,
        })

        expect(result.prNumbers).toEqual([])
      })

      it('only looks at first line for squash pattern', async () => {
        vi.mocked(fs.readFile).mockRejectedValue(new Error('File not found'))

        const mockClient = createMockClient({
          compareCommits: vi.fn().mockResolvedValue({
            commits: [
              {
                commit: {
                  message: 'feat: add feature\n\nRelated to (#99)',
                },
              }, // #99 is in body, not title
            ],
          }),
        })

        const result = await collectMetadata({
          baseBranch: 'production',
          headBranch: 'main',
          outputPath: '/tmp/metadata.json',
          cachePath: '/tmp/cache.json',
          includeSquashed: true,
          client: mockClient as never,
        })

        expect(result.prNumbers).toEqual([])
      })

      it('uses default includeSquashed value of false', async () => {
        vi.mocked(fs.readFile).mockRejectedValue(new Error('File not found'))

        const mockClient = createMockClient({
          compareCommits: vi.fn().mockResolvedValue({
            commits: [{ commit: { message: 'feat: squashed feature (#10)' } }],
          }),
        })

        const result = await collectMetadata({
          baseBranch: 'production',
          headBranch: 'main',
          outputPath: '/tmp/metadata.json',
          cachePath: '/tmp/cache.json',
          // includeSquashed not specified
          client: mockClient as never,
        })

        expect(result.prNumbers).toEqual([])
      })
    })
  })

  describe('run', () => {
    const createMockContext = (overrides: Partial<RunContext> = {}): RunContext => ({
      env: {},
      argv: [],
      cwd: () => '/test',
      ...overrides,
    })

    const createMockDeps = (overrides: Partial<RunDeps> = {}): RunDeps => ({
      core: {
        info: vi.fn(),
        warning: vi.fn(),
        setOutput: vi.fn(),
        setFailed: vi.fn(),
      },
      fs: {
        readFile: vi.fn(),
        writeFile: vi.fn(),
        mkdir: vi.fn(),
      },
      ...overrides,
    })

    it('collects metadata using branch comparison', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('File not found'))
      vi.mocked(fs.writeFile).mockResolvedValue(undefined)
      vi.mocked(fs.mkdir).mockResolvedValue(undefined)

      mockCreateGitHubClientFromEnv.mockReturnValue({
        findOpenPullRequest: vi.fn().mockResolvedValue([{ number: 123 }]),
        compareCommits: vi.fn().mockResolvedValue({
          commits: [{ commit: { message: 'Merge pull request #1 from test/feature' } }],
        }),
        getPullRequest: vi.fn().mockImplementation((num: number) => {
          return Promise.resolve({
            number: num,
            title: `PR ${num}`,
            body: 'Description',
            html_url: `https://github.com/test/pr/${num}`,
            labels: [],
            user: { login: `user${num}` },
            additions: 10,
            deletions: 5,
            changed_files: 2,
            updated_at: '2024-01-15T10:00:00Z',
            head: { sha: `sha${num}` },
          })
        }),
        getPullRequestFiles: vi.fn().mockResolvedValue([{ filename: 'src/index.ts' }]),
        getPullRequestCommits: vi.fn().mockResolvedValue([{ sha: 'abc', commit: { message: 'Initial commit' } }]),
      } as never)

      const mockContext = createMockContext({
        env: {
          RELEASE_BASE: 'production',
          RELEASE_HEAD: 'main',
          RELEASE_METADATA_PATH: '.smart-pr-release/metadata.json',
          RELEASE_CACHE_PATH: '.smart-pr-release/cache/pr-cache.json',
        },
      })
      const mockDeps = createMockDeps()

      await run(mockContext, mockDeps)

      expect(mockDeps.core.setFailed).not.toHaveBeenCalled()
      expect(mockDeps.core.setOutput).toHaveBeenCalledWith('existing_pr_number', '123')
      expect(mockDeps.core.setOutput).toHaveBeenCalledWith('pr_numbers', '1')
    })

    it('outputs empty string when no existing PR', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('File not found'))
      vi.mocked(fs.writeFile).mockResolvedValue(undefined)
      vi.mocked(fs.mkdir).mockResolvedValue(undefined)

      mockCreateGitHubClientFromEnv.mockReturnValue({
        findOpenPullRequest: vi.fn().mockResolvedValue([]),
        compareCommits: vi.fn().mockResolvedValue({
          commits: [{ commit: { message: 'Merge pull request #1 from test/feature' } }],
        }),
        getPullRequest: vi.fn().mockImplementation((num: number) => {
          return Promise.resolve({
            number: num,
            title: `PR ${num}`,
            body: 'Description',
            html_url: `https://github.com/test/pr/${num}`,
            labels: [],
            user: { login: `user${num}` },
            additions: 10,
            deletions: 5,
            changed_files: 2,
            updated_at: '2024-01-15T10:00:00Z',
            head: { sha: `sha${num}` },
          })
        }),
        getPullRequestFiles: vi.fn().mockResolvedValue([{ filename: 'src/index.ts' }]),
        getPullRequestCommits: vi.fn().mockResolvedValue([{ sha: 'abc', commit: { message: 'Initial commit' } }]),
      } as never)

      const mockContext = createMockContext({
        env: {
          RELEASE_BASE: 'production',
          RELEASE_HEAD: 'main',
        },
      })
      const mockDeps = createMockDeps()

      await run(mockContext, mockDeps)

      expect(mockDeps.core.setOutput).toHaveBeenCalledWith('existing_pr_number', '')
    })

    it('uses cwd for path validation', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('File not found'))
      vi.mocked(fs.writeFile).mockResolvedValue(undefined)
      vi.mocked(fs.mkdir).mockResolvedValue(undefined)

      mockCreateGitHubClientFromEnv.mockReturnValue({
        findOpenPullRequest: vi.fn().mockResolvedValue([]),
        compareCommits: vi.fn().mockResolvedValue({ commits: [] }),
        getPullRequest: vi.fn().mockResolvedValue({}),
        getPullRequestFiles: vi.fn().mockResolvedValue([]),
        getPullRequestCommits: vi.fn().mockResolvedValue([]),
      } as never)

      const mockContext = createMockContext({
        cwd: () => '/custom/path',
      })
      const mockDeps = createMockDeps()

      await run(mockContext, mockDeps)

      expect(mockDeps.core.setFailed).not.toHaveBeenCalled()
    })

    it('rejects path traversal attempts', async () => {
      const mockContext = createMockContext({
        env: {
          RELEASE_METADATA_PATH: '../../../etc/passwd',
        },
      })
      const mockDeps = createMockDeps()

      await run(mockContext, mockDeps)

      expect(mockDeps.core.setFailed).toHaveBeenCalledWith('Invalid path: outside allowed directory')
    })

    it('calls setFailed with generic message on non-Error', async () => {
      mockCreateGitHubClientFromEnv.mockReturnValue({
        findOpenPullRequest: vi.fn().mockRejectedValue('string error'),
      } as never)

      const mockContext = createMockContext()
      const mockDeps = createMockDeps()

      await run(mockContext, mockDeps)

      expect(mockDeps.core.setFailed).toHaveBeenCalledWith('An unexpected error occurred')
    })

    it('passes includeSquashed from environment variable', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('File not found'))
      vi.mocked(fs.writeFile).mockResolvedValue(undefined)
      vi.mocked(fs.mkdir).mockResolvedValue(undefined)

      const mockCompareCommits = vi.fn().mockResolvedValue({
        commits: [{ commit: { message: 'feat: squashed feature (#10)' } }],
      })

      mockCreateGitHubClientFromEnv.mockReturnValue({
        findOpenPullRequest: vi.fn().mockResolvedValue([]),
        compareCommits: mockCompareCommits,
        getPullRequest: vi.fn().mockImplementation((num: number) => {
          return Promise.resolve({
            number: num,
            title: `PR ${num}`,
            body: 'Description',
            html_url: `https://github.com/test/pr/${num}`,
            labels: [],
            user: { login: `user${num}` },
            additions: 10,
            deletions: 5,
            changed_files: 2,
            updated_at: '2024-01-15T10:00:00Z',
            head: { sha: `sha${num}` },
          })
        }),
        getPullRequestFiles: vi.fn().mockResolvedValue([{ filename: 'src/index.ts' }]),
        getPullRequestCommits: vi.fn().mockResolvedValue([{ sha: 'abc', commit: { message: 'Initial commit' } }]),
      } as never)

      const mockContext = createMockContext({
        env: {
          RELEASE_BASE: 'production',
          RELEASE_HEAD: 'main',
          RELEASE_INCLUDE_SQUASHED: 'true',
        },
      })
      const mockDeps = createMockDeps()

      await run(mockContext, mockDeps)

      expect(mockDeps.core.setOutput).toHaveBeenCalledWith('pr_numbers', '10')
    })

    it('defaults includeSquashed to false when not set', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('File not found'))
      vi.mocked(fs.writeFile).mockResolvedValue(undefined)
      vi.mocked(fs.mkdir).mockResolvedValue(undefined)

      mockCreateGitHubClientFromEnv.mockReturnValue({
        findOpenPullRequest: vi.fn().mockResolvedValue([]),
        compareCommits: vi.fn().mockResolvedValue({
          commits: [{ commit: { message: 'feat: squashed feature (#10)' } }],
        }),
        getPullRequest: vi.fn().mockResolvedValue({}),
        getPullRequestFiles: vi.fn().mockResolvedValue([]),
        getPullRequestCommits: vi.fn().mockResolvedValue([]),
      } as never)

      const mockContext = createMockContext({
        env: {
          RELEASE_BASE: 'production',
          RELEASE_HEAD: 'main',
          // RELEASE_INCLUDE_SQUASHED not set
        },
      })
      const mockDeps = createMockDeps()

      await run(mockContext, mockDeps)

      // Should not find the squashed PR since includeSquashed defaults to false
      expect(mockDeps.core.setOutput).toHaveBeenCalledWith('pr_numbers', '')
    })

    it('rejects paths containing symlinks in path segments', async () => {
      // Mock lstat: baseDir is OK, but path segment is a symlink
      vi.mocked(fs.lstat).mockImplementation(async (pathArg) => {
        const pathStr = String(pathArg)
        if (pathStr === '/test') {
          // baseDir is OK
          return { isSymbolicLink: () => false } as fs.Stats
        }
        if (pathStr.includes('.smart-pr-release')) {
          // Path segment is a symlink
          return { isSymbolicLink: () => true } as fs.Stats
        }
        // Other paths don't exist
        const enoentError = Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
        throw enoentError
      })

      const mockContext = createMockContext({
        env: {
          RELEASE_METADATA_PATH: '.smart-pr-release/metadata.json',
        },
      })
      const mockDeps = createMockDeps()

      await run(mockContext, mockDeps)

      expect(mockDeps.core.setFailed).toHaveBeenCalledWith('Invalid path: symlinks are not allowed')
    })

    it('allows paths when directory does not exist yet', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('File not found'))
      vi.mocked(fs.writeFile).mockResolvedValue(undefined)
      vi.mocked(fs.mkdir).mockResolvedValue(undefined)
      // lstat throws ENOENT for non-existent paths (set in beforeEach)

      mockCreateGitHubClientFromEnv.mockReturnValue({
        findOpenPullRequest: vi.fn().mockResolvedValue([]),
        compareCommits: vi.fn().mockResolvedValue({ commits: [] }),
        getPullRequest: vi.fn().mockResolvedValue({}),
        getPullRequestFiles: vi.fn().mockResolvedValue([]),
        getPullRequestCommits: vi.fn().mockResolvedValue([]),
      } as never)

      const mockContext = createMockContext({
        env: {
          RELEASE_METADATA_PATH: '.smart-pr-release/new-dir/metadata.json',
        },
      })
      const mockDeps = createMockDeps()

      await run(mockContext, mockDeps)

      expect(mockDeps.core.setFailed).not.toHaveBeenCalled()
    })

    it('allows paths with existing non-symlink directories', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('File not found'))
      vi.mocked(fs.writeFile).mockResolvedValue(undefined)
      vi.mocked(fs.mkdir).mockResolvedValue(undefined)
      // Mock lstat to return a regular directory (not a symlink)
      vi.mocked(fs.lstat).mockResolvedValue({
        isSymbolicLink: () => false,
      } as fs.Stats)

      mockCreateGitHubClientFromEnv.mockReturnValue({
        findOpenPullRequest: vi.fn().mockResolvedValue([]),
        compareCommits: vi.fn().mockResolvedValue({ commits: [] }),
        getPullRequest: vi.fn().mockResolvedValue({}),
        getPullRequestFiles: vi.fn().mockResolvedValue([]),
        getPullRequestCommits: vi.fn().mockResolvedValue([]),
      } as never)

      const mockContext = createMockContext({
        env: {
          RELEASE_METADATA_PATH: '.smart-pr-release/metadata.json',
        },
      })
      const mockDeps = createMockDeps()

      await run(mockContext, mockDeps)

      expect(mockDeps.core.setFailed).not.toHaveBeenCalled()
    })

    it('rejects when baseDir itself is a symlink', async () => {
      // Mock lstat to return a symlink for the baseDir (first call)
      vi.mocked(fs.lstat).mockResolvedValueOnce({
        isSymbolicLink: () => true,
      } as fs.Stats)

      const mockContext = createMockContext({
        env: {
          RELEASE_METADATA_PATH: '.smart-pr-release/metadata.json',
        },
      })
      const mockDeps = createMockDeps()

      await run(mockContext, mockDeps)

      expect(mockDeps.core.setFailed).toHaveBeenCalledWith('Invalid base directory: symlinks are not allowed')
    })

    it('rejects when baseDir does not exist', async () => {
      // Mock lstat to throw ENOENT for the baseDir
      const enoentError = Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      vi.mocked(fs.lstat).mockRejectedValueOnce(enoentError)

      const mockContext = createMockContext({
        cwd: () => '/nonexistent/path',
        env: {
          RELEASE_METADATA_PATH: '.smart-pr-release/metadata.json',
        },
      })
      const mockDeps = createMockDeps()

      await run(mockContext, mockDeps)

      expect(mockDeps.core.setFailed).toHaveBeenCalledWith('Base directory does not exist')
    })

    it('uses GITHUB_WORKSPACE as base directory when set', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('File not found'))
      vi.mocked(fs.writeFile).mockResolvedValue(undefined)
      vi.mocked(fs.mkdir).mockResolvedValue(undefined)

      // Mock lstat to allow /workspace/caller-repo as valid base directory
      vi.mocked(fs.lstat).mockImplementation(async (pathArg) => {
        const pathStr = String(pathArg)
        if (pathStr === '/workspace/caller-repo') {
          return { isSymbolicLink: () => false } as fs.Stats
        }
        // For other paths, throw ENOENT (will be created)
        const enoentError = Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
        throw enoentError
      })

      mockCreateGitHubClientFromEnv.mockReturnValue({
        findOpenPullRequest: vi.fn().mockResolvedValue([]),
        compareCommits: vi.fn().mockResolvedValue({ commits: [] }),
        getPullRequest: vi.fn().mockResolvedValue({}),
        getPullRequestFiles: vi.fn().mockResolvedValue([]),
        getPullRequestCommits: vi.fn().mockResolvedValue([]),
      } as never)

      const mockContext = createMockContext({
        env: {
          GITHUB_WORKSPACE: '/workspace/caller-repo',
          RELEASE_METADATA_PATH: '.smart-pr-release/metadata.json',
          RELEASE_CACHE_PATH: '.smart-pr-release/cache/pr-cache.json',
        },
        cwd: () => '/action-repo', // cwd is different from GITHUB_WORKSPACE
      })
      const mockDeps = createMockDeps()

      await run(mockContext, mockDeps)

      expect(mockDeps.core.setFailed).not.toHaveBeenCalled()

      // Verify fs.writeFile was called with paths relative to GITHUB_WORKSPACE
      const writeCalls = vi.mocked(fs.writeFile).mock.calls
      const metadataWriteCall = writeCalls.find(
        (call) => typeof call[0] === 'string' && call[0].includes('metadata.json'),
      )
      expect(metadataWriteCall).toBeDefined()
      expect(metadataWriteCall?.[0]).toBe('/workspace/caller-repo/.smart-pr-release/metadata.json')
    })

    it('falls back to cwd when GITHUB_WORKSPACE is not set', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('File not found'))
      vi.mocked(fs.writeFile).mockResolvedValue(undefined)
      vi.mocked(fs.mkdir).mockResolvedValue(undefined)

      // Mock lstat to allow /action-repo as valid base directory
      vi.mocked(fs.lstat).mockImplementation(async (pathArg) => {
        const pathStr = String(pathArg)
        if (pathStr === '/action-repo') {
          return { isSymbolicLink: () => false } as fs.Stats
        }
        const enoentError = Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
        throw enoentError
      })

      mockCreateGitHubClientFromEnv.mockReturnValue({
        findOpenPullRequest: vi.fn().mockResolvedValue([]),
        compareCommits: vi.fn().mockResolvedValue({ commits: [] }),
        getPullRequest: vi.fn().mockResolvedValue({}),
        getPullRequestFiles: vi.fn().mockResolvedValue([]),
        getPullRequestCommits: vi.fn().mockResolvedValue([]),
      } as never)

      const mockContext = createMockContext({
        env: {
          // GITHUB_WORKSPACE is not set
          RELEASE_METADATA_PATH: '.smart-pr-release/metadata.json',
        },
        cwd: () => '/action-repo',
      })
      const mockDeps = createMockDeps()

      await run(mockContext, mockDeps)

      expect(mockDeps.core.setFailed).not.toHaveBeenCalled()

      // Verify fs.writeFile was called with paths relative to cwd
      const writeCalls = vi.mocked(fs.writeFile).mock.calls
      const metadataWriteCall = writeCalls.find(
        (call) => typeof call[0] === 'string' && call[0].includes('metadata.json'),
      )
      expect(metadataWriteCall).toBeDefined()
      expect(metadataWriteCall?.[0]).toBe('/action-repo/.smart-pr-release/metadata.json')
    })
  })
})
