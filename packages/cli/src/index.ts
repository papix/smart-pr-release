#!/usr/bin/env node

import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { program } from 'commander'
import dotenv from 'dotenv'

// Load .env.local if not in CI
if (!process.env.CI) {
  const envLocalPath = resolve(process.cwd(), '.env.local')
  if (existsSync(envLocalPath)) {
    // Validate path to prevent symlink attacks
    const realPath = realpathSync(envLocalPath)
    const cwd = realpathSync(process.cwd())
    if (!realPath.startsWith(`${cwd}/`) && realPath !== cwd) {
      console.warn('Warning: .env.local path is outside project directory, skipping')
    } else {
      dotenv.config({ path: envLocalPath, quiet: true })
    }
  }
}

import { type CollectMetadataResult, collectMetadata } from '@actions/smart-pr-release-collect/src/index.js'
import { createReleasePR } from '@actions/smart-pr-release-create/src/index.js'
import { type LLMProvider, renderReleasePR } from '@actions/smart-pr-release-render/src/index.js'
import { loadConfig } from '#core/config.js'
import { GitHubClient } from '#core/github-api.js'
import { hasLLMCalls } from '#core/template.js'
import { mergeOptions } from './merge-options.js'

const VERSION = '0.1.0'

interface CliOptions {
  repo: string
  base: string
  head: string
  provider: LLMProvider
  template: string
  language: string
  labels: string[]
  squashed: boolean
  execute: boolean
  json: boolean
  debug: boolean
}

function log(options: CliOptions, message: string): void {
  if (!options.json) {
    console.log(message)
  }
}

function debug(options: CliOptions, message: string): void {
  if (options.debug && !options.json) {
    console.log(`[DEBUG] ${message}`)
  }
}

function handleError(message: string, jsonMode: boolean): never {
  if (jsonMode) {
    console.log(JSON.stringify({ error: message }, null, 2))
  } else {
    console.error(`Error: ${message}`)
  }
  process.exit(1)
}

function createGitHubClient(repo: string, jsonMode: boolean): GitHubClient {
  const token = process.env.GITHUB_TOKEN
  if (!token) {
    handleError('GITHUB_TOKEN environment variable is required', jsonMode)
  }

  const [owner, repoName] = repo.split('/')
  if (!owner || !repoName) {
    handleError('Invalid repo format. Expected "owner/repo"', jsonMode)
  }

  return new GitHubClient({
    token,
    owner,
    repo: repoName,
  })
}

function getApiKey(jsonMode: boolean): string {
  const key = process.env.OPENAI_API_KEY
  if (!key) {
    handleError('OPENAI_API_KEY environment variable is required when using --provider openai', jsonMode)
  }
  return key
}

function printHeader(options: CliOptions): void {
  log(options, '='.repeat(60))
  log(options, 'smart-pr-release')
  log(options, '='.repeat(60))
  log(options, `Repository: ${options.repo}`)
  log(options, `Base branch: ${options.base}`)
  log(options, `Head branch: ${options.head}`)
  log(options, `Provider: ${options.provider}`)
  log(options, `Template: ${options.template}`)
  if (options.labels.length > 0) {
    log(options, `Labels: ${options.labels.join(', ')}`)
  }
  if (options.squashed) {
    log(options, 'Squash merge detection: enabled')
  }
  log(options, `Mode: ${options.execute ? 'execute' : 'dry-run (default)'}`)
  log(options, '='.repeat(60))
}

function printDryRunPreview(
  options: CliOptions,
  collectResult: CollectMetadataResult,
  renderResult: { title: string; body: string },
): void {
  log(options, '\n=== Preview: Release PR ===')
  log(options, `Title: ${renderResult.title}`)
  log(options, `Base: ${options.base} ← Head: ${options.head}`)
  log(options, `Included PRs: ${collectResult.prNumbers.length}`)
  log(options, '')
  log(options, '--- Body ---')
  log(options, renderResult.body)
  log(options, '--- End of Body ---')
  log(options, '')
  if (collectResult.existingPrNumber) {
    log(options, `To update PR #${collectResult.existingPrNumber}, run with --execute`)
  } else {
    log(options, 'To create a new PR, run with --execute')
  }
}

function printDryRunJson(collectResult: CollectMetadataResult, renderResult: { title: string; body: string }): void {
  console.log(
    JSON.stringify(
      {
        existingPrNumber: collectResult.existingPrNumber,
        title: renderResult.title,
        body: renderResult.body,
        execute: false,
        prCount: collectResult.prNumbers.length,
      },
      null,
      2,
    ),
  )
}

function printFooter(options: CliOptions): void {
  log(options, `\n${'='.repeat(60)}`)
  log(options, 'Output files:')
  log(options, '  - .smart-pr-release/metadata.json')
  if (options.provider !== 'none') {
    log(options, '  - .smart-pr-release/audit.json')
  }
  log(options, '='.repeat(60))
}

function validateTemplate(options: CliOptions): string {
  const templatePath = resolve(process.cwd(), options.template)
  if (!existsSync(templatePath)) {
    handleError(`Template file not found: ${templatePath}`, options.json)
  }

  const templateContent = readFileSync(templatePath, 'utf8')
  const hasLLMCall = hasLLMCalls(templateContent)
  if (hasLLMCall && options.provider === 'none') {
    handleError(
      'Template contains LLM calls ({{ llm "..." }}) but --provider is not set. ' +
        'Please use --provider openai or remove LLM calls from template.',
      options.json,
    )
  }

  return templatePath
}

interface CreateResultOutput {
  prNumber: number
  prUrl: string
  created: boolean
}

function printExecuteResult(options: CliOptions, createResult: CreateResultOutput): void {
  if (options.json) {
    console.log(
      JSON.stringify(
        {
          prNumber: createResult.prNumber,
          prUrl: createResult.prUrl,
          created: createResult.created,
        },
        null,
        2,
      ),
    )
  } else {
    if (createResult.created) {
      log(options, `Created new release PR #${createResult.prNumber}`)
    } else {
      log(options, `Updated existing release PR #${createResult.prNumber}`)
    }
    log(options, `URL: ${createResult.prUrl}`)
  }
}

async function runCli(options: CliOptions): Promise<void> {
  if (!options.json) {
    printHeader(options)
  }

  debug(options, `Starting with options: ${JSON.stringify(options)}`)

  process.env.GITHUB_REPOSITORY = options.repo

  const client = createGitHubClient(options.repo, options.json)

  log(options, '\n[Step 1] Collecting metadata...')
  const collectResult: CollectMetadataResult = await collectMetadata({
    baseBranch: options.base,
    headBranch: options.head,
    outputPath: '.smart-pr-release/metadata.json',
    cachePath: '.smart-pr-release/cache/pr-cache.json',
    includeSquashed: options.squashed,
    client,
  })

  log(options, `Collected metadata for ${collectResult.prNumbers.length} PRs`)
  if (collectResult.existingPrNumber) {
    log(options, `Found existing release PR: #${collectResult.existingPrNumber}`)
  } else {
    log(options, 'No existing release PR found')
  }

  log(options, '\n[Step 2] Rendering template...')

  const templatePath = validateTemplate(options)
  const apiKey = options.provider !== 'none' ? getApiKey(options.json) : undefined

  const renderResult = await renderReleasePR({
    templatePath,
    metadata: collectResult.metadata,
    provider: options.provider,
    apiKey,
    outputLanguage: options.language,
  })

  log(options, `Rendered title: ${renderResult.title}`)

  log(options, '\n[Step 3] PR Create/Update...')

  if (!options.execute) {
    if (options.json) {
      printDryRunJson(collectResult, renderResult)
    } else {
      printDryRunPreview(options, collectResult, renderResult)
    }
  } else {
    const createResult = await createReleasePR({
      baseBranch: options.base,
      headBranch: options.head,
      title: renderResult.title,
      body: renderResult.body,
      labels: options.labels,
      existingPrNumber: collectResult.existingPrNumber,
      client,
    })

    printExecuteResult(options, createResult)
  }

  if (!options.json) {
    printFooter(options)
  }
}

program
  .name('smart-pr-release')
  .description('Create and update release pull requests with optional AI-powered summaries.')
  .version(VERSION, '-v, --version', 'Show version')
  .option('-r, --repo <owner/repo>', 'GitHub repository (default: GITHUB_REPOSITORY env)')
  .option('-b, --base <branch>', 'Base branch for release (default: production)')
  .option('-H, --head <branch>', 'Head branch for release (default: main)')
  .option('-t, --template <path>', 'Path to template file (required)')
  .option('--provider <name>', 'AI provider: openai | none (default: none)')
  .option('-l, --language <code>', 'Output language for AI summary (default: en)')
  .option('--labels <labels>', 'Comma-separated labels to add to the PR')
  .option('--squashed', 'Include squash merged PRs (detect from commit messages)', false)
  .option('--execute', 'Actually create/update the PR (default: dry-run mode)', false)
  .option('--json', 'Output in JSON format', false)
  .option('--debug', 'Enable debug output', false)
  .addHelpText(
    'after',
    `
Environment Variables:
  GITHUB_TOKEN              GitHub personal access token (required)
  OPENAI_API_KEY            OpenAI API key (required if --provider openai)
  GITHUB_REPOSITORY         Default repository (owner/repo)

Examples:
  # Preview changes (default: dry-run mode)
  smart-pr-release --repo owner/repo --template .github/release-template.md

  # Preview with AI summary
  smart-pr-release --repo owner/repo --template .github/release-template.md --provider openai

  # Actually create/update the PR
  smart-pr-release --repo owner/repo --template .github/release-template.md --execute`,
  )
  .action(async (opts) => {
    const jsonMode = opts.json ?? false
    const config = loadConfig()

    const result = mergeOptions(opts, config, process.env.GITHUB_REPOSITORY)

    if (result.error === 'repo is required') {
      if (jsonMode) {
        console.log(
          JSON.stringify(
            { error: '--repo is required (e.g., --repo owner/repo) or set GITHUB_REPOSITORY environment variable' },
            null,
            2,
          ),
        )
      } else {
        console.error('Error: --repo is required (e.g., --repo owner/repo)')
        console.error('       Or set GITHUB_REPOSITORY environment variable')
      }
      process.exit(1)
    }

    if (result.error === 'template is required') {
      if (jsonMode) {
        console.log(
          JSON.stringify(
            {
              error:
                '--template is required (e.g., --template .github/release-template.md) or set template in .smart-pr-release.yml',
            },
            null,
            2,
          ),
        )
      } else {
        console.error('Error: --template is required (e.g., --template .github/release-template.md)')
        console.error('       Or set template in .smart-pr-release.yml')
      }
      process.exit(1)
    }

    if (result.error || !result.options) {
      handleError(result.error ?? 'Unknown error', jsonMode)
    }

    await runCli(result.options)
  })

program.parse()
