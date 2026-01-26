import * as core from '@actions/core'
import { createDefaultContext, createDefaultDeps, type RunContext, type RunDeps } from '#core/cli-types.js'
import { createGitHubClientFromEnv, type GitHubClient } from '#core/github-api.js'

export interface CreateReleasePROptions {
  baseBranch: string
  headBranch: string
  title: string
  body: string
  labels?: string[]
  existingPrNumber?: number
  client?: GitHubClient
}

export interface CreateReleasePRResult {
  prNumber: number
  prUrl: string
  created: boolean
}

/**
 * Create or update release PR
 */
export async function createReleasePR(options: CreateReleasePROptions): Promise<CreateReleasePRResult> {
  const { baseBranch, headBranch, title, body, labels = [], existingPrNumber } = options
  const client = options.client || createGitHubClientFromEnv()

  // Update existing PR
  if (existingPrNumber) {
    core.info(`Updating existing release PR #${existingPrNumber}`)

    await client.updatePullRequest(existingPrNumber, {
      title,
      body,
    })

    // Add labels if specified
    if (labels.length > 0) {
      core.info(`Adding labels: ${labels.join(', ')}`)
      await client.addLabelsToIssue(existingPrNumber, labels)
    }

    const pr = await client.getPullRequest(existingPrNumber)

    core.info(`Updated release PR: #${existingPrNumber}`)

    return {
      prNumber: existingPrNumber,
      prUrl: pr.html_url,
      created: false,
    }
  }

  // Create new PR
  core.info(`Creating release PR: ${headBranch} -> ${baseBranch}`)
  core.info(`Title: ${title}`)

  const newPR = await client.createPullRequest({
    title,
    body,
    head: headBranch,
    base: baseBranch,
  })

  // Add labels if specified
  if (labels.length > 0) {
    core.info(`Adding labels: ${labels.join(', ')}`)
    await client.addLabelsToIssue(newPR.number, labels)
  }

  core.info(`Created release PR: #${newPR.number}`)

  return {
    prNumber: newPR.number,
    prUrl: newPR.html_url,
    created: true,
  }
}

export async function run(ctx: RunContext = createDefaultContext(), deps?: RunDeps): Promise<void> {
  const resolvedDeps = deps ?? (await createDefaultDeps())
  try {
    const baseBranch = ctx.env.RELEASE_BASE || 'production'
    const headBranch = ctx.env.RELEASE_HEAD || 'main'
    const title = ctx.env.RELEASE_TITLE
    const body = ctx.env.RELEASE_BODY
    const existingPrNumberStr = ctx.env.RELEASE_EXISTING_PR_NUMBER
    const labelsStr = ctx.env.RELEASE_LABELS || ''

    if (!title) {
      throw new Error('RELEASE_TITLE environment variable is required.')
    }

    if (body === undefined) {
      throw new Error('RELEASE_BODY environment variable is required.')
    }

    const existingPrNumber = existingPrNumberStr ? Number(existingPrNumberStr) : undefined
    const labels = labelsStr
      .split(',')
      .map((l) => l.trim())
      .filter((l) => l.length > 0)

    const client = createGitHubClientFromEnv()

    const result = await createReleasePR({
      baseBranch,
      headBranch,
      title,
      body,
      labels,
      existingPrNumber,
      client,
    })

    resolvedDeps.core.setOutput('pr_number', String(result.prNumber))
    resolvedDeps.core.setOutput('pr_url', result.prUrl)
    resolvedDeps.core.setOutput('created', result.created ? 'true' : 'false')
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
