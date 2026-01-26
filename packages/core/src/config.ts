import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'
import type { Config, LLMProvider } from './types.js'

const CONFIG_FILE_NAMES = ['.smart-pr-release.yml', '.smart-pr-release.yaml', '.smart-pr-release.json']

interface RawConfig {
  base?: unknown
  head?: unknown
  template?: unknown
  labels?: unknown
  provider?: unknown
  language?: unknown
  squashed?: unknown
}

function validateConfig(raw: RawConfig): Config {
  const config: Config = {}

  if (typeof raw.base === 'string' && raw.base.length > 0) {
    config.base = raw.base
  }

  if (typeof raw.head === 'string' && raw.head.length > 0) {
    config.head = raw.head
  }

  if (typeof raw.template === 'string' && raw.template.length > 0) {
    config.template = raw.template
  }

  if (Array.isArray(raw.labels)) {
    config.labels = raw.labels.filter((l): l is string => typeof l === 'string' && l.length > 0)
  }

  if (raw.provider === 'openai' || raw.provider === 'none') {
    config.provider = raw.provider as LLMProvider
  }

  if (typeof raw.language === 'string' && raw.language.length > 0) {
    config.language = raw.language
  }

  if (typeof raw.squashed === 'boolean') {
    config.squashed = raw.squashed
  }

  return config
}

/**
 * Load configuration from file
 *
 * Priority:
 * 1. CLI options (highest)
 * 2. Config file
 * 3. Environment variables
 * 4. Default values (lowest)
 */
export function loadConfig(basePath: string = process.cwd()): Config | null {
  for (const fileName of CONFIG_FILE_NAMES) {
    const configPath = resolve(basePath, fileName)

    if (!existsSync(configPath)) {
      continue
    }

    try {
      const content = readFileSync(configPath, 'utf8')

      let rawConfig: RawConfig

      if (fileName.endsWith('.json')) {
        rawConfig = JSON.parse(content) as RawConfig
      } else {
        rawConfig = parseYaml(content)
      }

      return validateConfig(rawConfig)
    } catch (error) {
      console.warn(
        `Warning: Failed to parse ${configPath}: ${error instanceof Error ? error.message : 'unknown error'}`,
      )
    }
  }

  return null
}

/**
 * Get config file names for documentation
 */
export function getConfigFileNames(): readonly string[] {
  return CONFIG_FILE_NAMES
}
