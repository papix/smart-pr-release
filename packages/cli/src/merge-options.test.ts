import { describe, expect, it } from 'vitest'
import type { Config } from '#core/types.js'
import { mergeOptions, type RawCliOptions } from './merge-options.js'

describe('mergeOptions', () => {
  it('should return error when repo is not provided', () => {
    const cliOpts: RawCliOptions = { template: 'template.md' }
    const config: Config = {}

    const result = mergeOptions(cliOpts, config, undefined)

    expect(result.error).toBe('repo is required')
    expect(result.options).toBeUndefined()
  })

  it('should return error when template is not provided', () => {
    const cliOpts: RawCliOptions = { repo: 'owner/repo' }
    const config: Config = {}

    const result = mergeOptions(cliOpts, config, undefined)

    expect(result.error).toBe('template is required')
    expect(result.options).toBeUndefined()
  })

  it('should use CLI options over config file values', () => {
    const cliOpts: RawCliOptions = {
      repo: 'cli-owner/cli-repo',
      base: 'cli-base',
      head: 'cli-head',
      provider: 'openai',
      template: 'cli-template.md',
      language: 'ja',
      labels: 'cli-label1, cli-label2',
      squashed: true,
    }
    const config: Config = {
      base: 'config-base',
      head: 'config-head',
      provider: 'none',
      template: 'config-template.md',
      language: 'en',
      labels: ['config-label'],
      squashed: false,
    }

    const result = mergeOptions(cliOpts, config, undefined)

    expect(result.options).toEqual({
      repo: 'cli-owner/cli-repo',
      base: 'cli-base',
      head: 'cli-head',
      provider: 'openai',
      template: 'cli-template.md',
      language: 'ja',
      labels: ['cli-label1', 'cli-label2'],
      squashed: true,
      execute: false,
      json: false,
      debug: false,
    })
  })

  it('should use config file values when CLI options are not provided', () => {
    const cliOpts: RawCliOptions = {
      repo: 'owner/repo',
    }
    const config: Config = {
      base: 'config-base',
      head: 'config-head',
      provider: 'openai',
      template: 'config-template.md',
      language: 'ja',
      labels: ['config-label1', 'config-label2'],
      squashed: true,
    }

    const result = mergeOptions(cliOpts, config, undefined)

    expect(result.options).toEqual({
      repo: 'owner/repo',
      base: 'config-base',
      head: 'config-head',
      provider: 'openai',
      template: 'config-template.md',
      language: 'ja',
      labels: ['config-label1', 'config-label2'],
      squashed: true,
      execute: false,
      json: false,
      debug: false,
    })
  })

  it('should use default values when neither CLI nor config provides values', () => {
    const cliOpts: RawCliOptions = {
      repo: 'owner/repo',
      template: 'template.md',
    }
    const config: Config = {}

    const result = mergeOptions(cliOpts, config, undefined)

    expect(result.options).toEqual({
      repo: 'owner/repo',
      base: 'production',
      head: 'main',
      provider: 'none',
      template: 'template.md',
      language: 'en',
      labels: [],
      squashed: false,
      execute: false,
      json: false,
      debug: false,
    })
  })

  it('should use env repo when CLI repo is not provided', () => {
    const cliOpts: RawCliOptions = {
      template: 'template.md',
    }
    const config: Config = {}

    const result = mergeOptions(cliOpts, config, 'env-owner/env-repo')

    expect(result.options?.repo).toBe('env-owner/env-repo')
  })

  it('should prefer CLI repo over env repo', () => {
    const cliOpts: RawCliOptions = {
      repo: 'cli-owner/cli-repo',
      template: 'template.md',
    }
    const config: Config = {}

    const result = mergeOptions(cliOpts, config, 'env-owner/env-repo')

    expect(result.options?.repo).toBe('cli-owner/cli-repo')
  })

  it('should handle empty labels string', () => {
    const cliOpts: RawCliOptions = {
      repo: 'owner/repo',
      template: 'template.md',
      labels: '',
    }
    const config: Config = {
      labels: ['config-label'],
    }

    const result = mergeOptions(cliOpts, config, undefined)

    // Empty string explicitly provided should result in empty array
    expect(result.options?.labels).toEqual([])
  })

  it('should handle null config', () => {
    const cliOpts: RawCliOptions = {
      repo: 'owner/repo',
      template: 'template.md',
    }

    const result = mergeOptions(cliOpts, null, undefined)

    expect(result.options).toEqual({
      repo: 'owner/repo',
      base: 'production',
      head: 'main',
      provider: 'none',
      template: 'template.md',
      language: 'en',
      labels: [],
      squashed: false,
      execute: false,
      json: false,
      debug: false,
    })
  })

  it('should trim labels and filter empty values', () => {
    const cliOpts: RawCliOptions = {
      repo: 'owner/repo',
      template: 'template.md',
      labels: '  label1  ,  , label2  ,  ',
    }
    const config: Config = {}

    const result = mergeOptions(cliOpts, config, undefined)

    expect(result.options?.labels).toEqual(['label1', 'label2'])
  })

  it('should handle execute, json, and debug flags', () => {
    const cliOpts: RawCliOptions = {
      repo: 'owner/repo',
      template: 'template.md',
      execute: true,
      json: true,
      debug: true,
    }
    const config: Config = {}

    const result = mergeOptions(cliOpts, config, undefined)

    expect(result.options?.execute).toBe(true)
    expect(result.options?.json).toBe(true)
    expect(result.options?.debug).toBe(true)
  })

  it('should return error for invalid provider from CLI', () => {
    const cliOpts: RawCliOptions = {
      repo: 'owner/repo',
      template: 'template.md',
      provider: 'invalid-provider',
    }
    const config: Config = {}

    const result = mergeOptions(cliOpts, config, undefined)

    expect(result.error).toBe('Invalid provider: invalid-provider. Valid providers are: openai, none')
    expect(result.options).toBeUndefined()
  })

  it('should return error for invalid provider from config', () => {
    const cliOpts: RawCliOptions = {
      repo: 'owner/repo',
      template: 'template.md',
    }
    // @ts-expect-error Testing invalid config value
    const config: Config = { provider: 'anthropic' }

    const result = mergeOptions(cliOpts, config, undefined)

    expect(result.error).toBe('Invalid provider: anthropic. Valid providers are: openai, none')
    expect(result.options).toBeUndefined()
  })

  it('should accept valid providers', () => {
    const validProviders = ['openai', 'none'] as const
    for (const provider of validProviders) {
      const cliOpts: RawCliOptions = {
        repo: 'owner/repo',
        template: 'template.md',
        provider,
      }
      const config: Config = {}

      const result = mergeOptions(cliOpts, config, undefined)

      expect(result.error).toBeUndefined()
      expect(result.options?.provider).toBe(provider)
    }
  })
})
