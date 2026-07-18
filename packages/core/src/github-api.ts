import { Octokit } from '@octokit/rest'
import { GitHubApiError } from './errors.js'

export interface GitHubClientConfig {
  token: string
  owner: string
  repo: string
  apiBase?: string
  timeout?: number
  maxRetries?: number
}

function convertOctokitError(error: unknown): GitHubApiError {
  // Octokit RequestError has status, message, and response
  if (error && typeof error === 'object' && 'status' in error) {
    const octokitError = error as { status: number; message: string }
    const status = octokitError.status

    if (status === 403) {
      // Check if it's a rate limit error
      if (octokitError.message.toLowerCase().includes('rate limit')) {
        return new GitHubApiError('GITHUB_RATE_LIMIT', 'GitHub API rate limit exceeded', 403)
      }
      return new GitHubApiError('GITHUB_AUTH_FAILED', 'GitHub API authentication failed', 403)
    }

    if (status === 401) {
      return new GitHubApiError('GITHUB_AUTH_FAILED', 'GitHub API authentication failed', 401)
    }

    if (status >= 500) {
      return new GitHubApiError('GITHUB_SERVER_ERROR', 'GitHub API server error', status)
    }

    return new GitHubApiError('GITHUB_REQUEST_FAILED', `GitHub API error ${status}`, status)
  }

  // Handle timeout/network errors
  if (error instanceof Error) {
    if (error.name === 'AbortError' || error.message.includes('timeout')) {
      return new GitHubApiError('GITHUB_REQUEST_TIMEOUT', 'GitHub API request timeout')
    }
    return new GitHubApiError('GITHUB_REQUEST_FAILED', error.message)
  }

  return new GitHubApiError('GITHUB_REQUEST_FAILED', 'GitHub API request failed')
}

export class GitHubClient {
  private readonly octokit: Octokit
  private readonly owner: string
  private readonly repo: string

  constructor(config: GitHubClientConfig) {
    this.owner = config.owner
    this.repo = config.repo

    const octokitOptions: ConstructorParameters<typeof Octokit>[0] = {
      auth: config.token,
      userAgent: 'smart-pr-release',
      request: {
        timeout: config.timeout ?? 30000,
      },
      retry: {
        enabled: true,
        retries: config.maxRetries ?? 3,
      },
    }

    if (config.apiBase) {
      octokitOptions.baseUrl = config.apiBase
    }

    this.octokit = new Octokit(octokitOptions)
  }

  async getPullRequest(prNumber: number): Promise<{
    number: number
    title: string
    body: string | null
    html_url: string
    base: { ref: string }
    head: { ref: string; sha: string }
    labels: Array<{ name: string }>
    additions: number
    deletions: number
    changed_files: number
    updated_at: string
    user: { login: string } | null
  }> {
    try {
      const { data } = await this.octokit.rest.pulls.get({
        owner: this.owner,
        repo: this.repo,
        pull_number: prNumber,
      })

      return {
        number: data.number,
        title: data.title,
        body: data.body,
        html_url: data.html_url,
        base: { ref: data.base.ref },
        head: { ref: data.head.ref, sha: data.head.sha },
        labels: data.labels.map((label) => ({
          name: typeof label === 'string' ? label : (label.name ?? ''),
        })),
        additions: data.additions,
        deletions: data.deletions,
        changed_files: data.changed_files,
        updated_at: data.updated_at,
        user: data.user ? { login: data.user.login } : null,
      }
    } catch (error) {
      throw convertOctokitError(error)
    }
  }

  async updatePullRequest(prNumber: number, params: { title?: string; body?: string }): Promise<void> {
    try {
      await this.octokit.rest.pulls.update({
        owner: this.owner,
        repo: this.repo,
        pull_number: prNumber,
        ...params,
      })
    } catch (error) {
      throw convertOctokitError(error)
    }
  }

  async findOpenPullRequest(base: string, head: string): Promise<Array<{ number: number }>> {
    try {
      const { data } = await this.octokit.rest.pulls.list({
        owner: this.owner,
        repo: this.repo,
        state: 'open',
        base,
        head: `${this.owner}:${head}`,
        per_page: 1,
      })

      return data.map((pr) => ({ number: pr.number }))
    } catch (error) {
      throw convertOctokitError(error)
    }
  }

  async getPullRequestFiles(prNumber: number): Promise<Array<{ filename?: string }>> {
    try {
      const files = await this.octokit.paginate(this.octokit.rest.pulls.listFiles, {
        owner: this.owner,
        repo: this.repo,
        pull_number: prNumber,
        per_page: 100,
      })

      return files.map((file) => ({ filename: file.filename }))
    } catch (error) {
      throw convertOctokitError(error)
    }
  }

  async getPullRequestCommits(prNumber: number): Promise<Array<{ sha: string; commit?: { message?: string } }>> {
    try {
      const commits = await this.octokit.paginate(this.octokit.rest.pulls.listCommits, {
        owner: this.owner,
        repo: this.repo,
        pull_number: prNumber,
        per_page: 100,
      })

      return commits.map((commit) => ({
        sha: commit.sha,
        commit: commit.commit ? { message: commit.commit.message } : undefined,
      }))
    } catch (error) {
      throw convertOctokitError(error)
    }
  }

  async createLabel(name: string, color: string, description: string): Promise<void> {
    try {
      await this.octokit.rest.issues.createLabel({
        owner: this.owner,
        repo: this.repo,
        name,
        color,
        description,
      })
    } catch (error) {
      // Ignore if label already exists (422 Unprocessable Entity)
      if (error && typeof error === 'object' && 'status' in error && error.status === 422) {
        return
      }
      throw convertOctokitError(error)
    }
  }

  async addLabelsToIssue(issueNumber: number, labels: string[]): Promise<void> {
    try {
      await this.octokit.rest.issues.addLabels({
        owner: this.owner,
        repo: this.repo,
        issue_number: issueNumber,
        labels,
      })
    } catch (error) {
      throw convertOctokitError(error)
    }
  }

  async compareCommits(
    base: string,
    head: string,
  ): Promise<{
    status: string
    ahead_by: number
    behind_by: number
    total_commits: number
    commits: Array<{
      sha: string
      commit: {
        message: string
        author?: { name?: string; email?: string; date?: string }
      }
    }>
  }> {
    try {
      const [baseCommit, headCommit] = await Promise.all([
        this.octokit.rest.repos.getCommit({
          owner: this.owner,
          repo: this.repo,
          ref: base,
        }),
        this.octokit.rest.repos.getCommit({
          owner: this.owner,
          repo: this.repo,
          ref: head,
        }),
      ])
      const baseSha = baseCommit.data.sha
      const headSha = headCommit.data.sha
      const perPage = 100
      let page = 1
      let hasMore = true
      let comparison: Awaited<ReturnType<typeof this.octokit.rest.repos.compareCommits>>['data'] | undefined
      const commits: Awaited<ReturnType<typeof this.octokit.rest.repos.compareCommits>>['data']['commits'] = []

      while (hasMore) {
        const { data } = await this.octokit.rest.repos.compareCommits({
          owner: this.owner,
          repo: this.repo,
          base: baseSha,
          head: headSha,
          page,
          per_page: perPage,
        })

        comparison ??= data
        commits.push(...data.commits)
        hasMore = commits.length < data.total_commits && data.commits.length === perPage
        if (hasMore) {
          page += 1
        }
      }

      if (!comparison) {
        throw new Error('GitHub Compare API returned no comparison data')
      }

      if (commits.length !== comparison.total_commits) {
        throw new Error(`GitHub Compare API returned ${commits.length} of ${comparison.total_commits} commits`)
      }

      return {
        status: comparison.status,
        ahead_by: comparison.ahead_by,
        behind_by: comparison.behind_by,
        total_commits: comparison.total_commits,
        commits: commits.map((commit) => ({
          sha: commit.sha,
          commit: {
            message: commit.commit.message,
            author: commit.commit.author
              ? {
                  name: commit.commit.author.name ?? undefined,
                  email: commit.commit.author.email ?? undefined,
                  date: commit.commit.author.date ?? undefined,
                }
              : undefined,
          },
        })),
      }
    } catch (error) {
      throw convertOctokitError(error)
    }
  }

  async createPullRequest(params: {
    title: string
    body: string
    head: string
    base: string
  }): Promise<{ number: number; html_url: string }> {
    try {
      const { data } = await this.octokit.rest.pulls.create({
        owner: this.owner,
        repo: this.repo,
        ...params,
      })

      return {
        number: data.number,
        html_url: data.html_url,
      }
    } catch (error) {
      throw convertOctokitError(error)
    }
  }
}

/**
 * Create a GitHubClient from environment variables
 */
export function createGitHubClientFromEnv(): GitHubClient {
  const token = process.env.GITHUB_TOKEN
  if (!token) {
    throw new Error('Missing GITHUB_TOKEN environment variable')
  }

  const repoSlug = process.env.GITHUB_REPOSITORY
  if (!repoSlug) {
    throw new Error('Missing GITHUB_REPOSITORY environment variable')
  }

  const [owner, repo] = repoSlug.split('/')
  if (!owner || !repo) {
    throw new Error(`Invalid GITHUB_REPOSITORY: ${repoSlug}`)
  }

  return new GitHubClient({
    token,
    owner,
    repo,
    apiBase: process.env.GITHUB_API_URL,
  })
}
