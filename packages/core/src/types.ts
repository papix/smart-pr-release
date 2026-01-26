export interface ActionInputs {
  baseBranch: string
  headBranch: string
  githubToken: string
  prNumber?: number
}

export interface PullRequest {
  number: number
  title: string
  body: string | null
  url: string
  base: { ref: string }
  head: { ref: string }
  labels: string[]
  additions: number
  deletions: number
  changedFiles: number
}

export interface PullRequestBasic {
  number: number
  title: string
  author: string
}

export interface PullRequestDetail extends PullRequestBasic {
  labels: string[]
  url: string
  description: string | null
  additions: number
  deletions: number
  changedFiles: number
}

export interface ReleaseStats {
  totalAdditions: number
  totalDeletions: number
  totalChangedFiles: number
  extensionCounts: Record<string, number>
  commitMessages: string[]
  hasEnvFiles: boolean
  hasCredentialFiles: boolean
  hasSecretFiles: boolean
  hasMigrationFiles: boolean
}

export interface ReleaseMetadata {
  generatedAt: string
  releasePr?: {
    number: number
    title: string
    base: string | undefined
    head: string | undefined
    url: string
  }
  baseBranch: string
  headBranch: string
  releasePrBody?: string // PR body (for template prompt extraction)
  prs: PullRequestDetail[]
  stats: ReleaseStats
}

export interface AiOutput {
  sections: Record<string, string[]>
}

export interface MaskResult {
  masked: string
  count: number
}

export interface LLMClientOptions {
  model?: string
  temperature?: number
  baseUrl?: string
}

export type LLMProvider = 'openai' | 'none'

export interface Config {
  base?: string
  head?: string
  template?: string
  labels?: string[]
  provider?: LLMProvider
  language?: string
  squashed?: boolean
}

// Cache types
export interface CommitInfo {
  sha: string
  message: string
}

export interface PRCacheEntry {
  number: number
  updatedAt: string // GitHub API's updated_at
  headSha: string // head.sha (for detecting commit additions)
  data: {
    title: string
    author: string
    labels: string[]
    url: string
    description: string | null // No limit
    additions: number
    deletions: number
    changedFiles: number
    files: string[]
    commits: CommitInfo[] // Retain all records
  }
  cachedAt: string
}

export interface PRCache {
  version: number
  generatedAt: string
  entries: Record<number, PRCacheEntry>
}

// GitHub API compare commits response
export interface CompareCommit {
  sha: string
  commit: {
    message: string
    author?: {
      name?: string
      email?: string
      date?: string
    }
  }
}

export interface CompareResult {
  status: string
  ahead_by: number
  behind_by: number
  total_commits: number
  commits: CompareCommit[]
}
