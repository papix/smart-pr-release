import type { Config, LLMProvider } from '#core/types.js'

const VALID_PROVIDERS = ['openai', 'none'] as const

export interface RawCliOptions {
  repo?: string
  base?: string
  head?: string
  provider?: string
  template?: string
  language?: string
  labels?: string
  squashed?: boolean
  execute?: boolean
  json?: boolean
  debug?: boolean
}

interface MergedOptions {
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

export interface MergeOptionsResult {
  options?: MergedOptions
  error?: string
}

export function mergeOptions(cliOpts: RawCliOptions, config: Config | null, envRepo?: string): MergeOptionsResult {
  const repo = cliOpts.repo ?? envRepo
  if (!repo) {
    return { error: 'repo is required' }
  }

  const template = cliOpts.template ?? config?.template
  if (!template) {
    return { error: 'template is required' }
  }

  const labels =
    cliOpts.labels !== undefined
      ? cliOpts.labels
          .split(',')
          .map((l) => l.trim())
          .filter((l) => l.length > 0)
      : (config?.labels ?? [])

  const base = cliOpts.base ?? config?.base ?? 'production'
  const head = cliOpts.head ?? config?.head ?? 'main'

  const providerValue = cliOpts.provider ?? config?.provider ?? 'none'
  if (!VALID_PROVIDERS.includes(providerValue as (typeof VALID_PROVIDERS)[number])) {
    return { error: `Invalid provider: ${providerValue}. Valid providers are: ${VALID_PROVIDERS.join(', ')}` }
  }
  const provider = providerValue as LLMProvider

  const language = cliOpts.language ?? config?.language ?? 'en'
  const squashed = cliOpts.squashed ?? config?.squashed ?? false

  return {
    options: {
      repo,
      base,
      head,
      provider,
      template,
      language,
      labels,
      squashed,
      execute: cliOpts.execute ?? false,
      json: cliOpts.json ?? false,
      debug: cliOpts.debug ?? false,
    },
  }
}
