import * as fs from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getConfigFileNames, loadConfig } from './config.js'

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}))

describe('loadConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  it('should return null when no config file exists', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false)

    const result = loadConfig('/test/path')

    expect(result).toBeNull()
    expect(fs.existsSync).toHaveBeenCalledTimes(3) // yml, yaml, json
  })

  it('should load YAML config file (.smart-pr-release.yml)', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readFileSync).mockReturnValue(`
base: production
head: main
template: .github/release-template.md.eta
provider: openai
language: ja
squashed: true
`)

    const result = loadConfig('/test/path')

    expect(result).toEqual({
      base: 'production',
      head: 'main',
      template: '.github/release-template.md.eta',
      provider: 'openai',
      language: 'ja',
      squashed: true,
    })
  })

  it('should load JSON config file', () => {
    // Mock: yml and yaml don't exist, but json does
    vi.mocked(fs.existsSync).mockImplementation((filePath) => {
      const pathStr = String(filePath)
      if (pathStr.endsWith('.yml') || pathStr.endsWith('.yaml')) {
        return false
      }
      return pathStr.endsWith('.json')
    })
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({
        base: 'staging',
        head: 'develop',
        template: 'template.md',
        labels: ['release', 'automated'],
        provider: 'none',
        language: 'en',
        squashed: false,
      }),
    )

    const result = loadConfig('/test/path')

    expect(result).toEqual({
      base: 'staging',
      head: 'develop',
      template: 'template.md',
      labels: ['release', 'automated'],
      provider: 'none',
      language: 'en',
      squashed: false,
    })
  })

  it('should parse YAML labels in multi-line format', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readFileSync).mockReturnValue(`
base: production
labels:
  - release
  - automated
  - important
`)

    const result = loadConfig('/test/path')

    expect(result).toEqual({
      base: 'production',
      labels: ['release', 'automated', 'important'],
    })
  })

  it('should parse YAML labels in inline array format', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readFileSync).mockReturnValue(`
base: production
labels: [release, automated]
`)

    const result = loadConfig('/test/path')

    expect(result).toEqual({
      base: 'production',
      labels: ['release', 'automated'],
    })
  })

  it('should handle quoted strings in YAML', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readFileSync).mockReturnValue(`
base: "production"
head: 'main'
template: .github/template.md
`)

    const result = loadConfig('/test/path')

    expect(result).toEqual({
      base: 'production',
      head: 'main',
      template: '.github/template.md',
    })
  })

  it('should skip comments in YAML', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readFileSync).mockReturnValue(`
# This is a comment
base: production
# Another comment
head: main
`)

    const result = loadConfig('/test/path')

    expect(result).toEqual({
      base: 'production',
      head: 'main',
    })
  })

  it('should skip empty lines in YAML', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readFileSync).mockReturnValue(`
base: production

head: main

`)

    const result = loadConfig('/test/path')

    expect(result).toEqual({
      base: 'production',
      head: 'main',
    })
  })

  it('should handle invalid provider value', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readFileSync).mockReturnValue(`
base: production
provider: invalid-provider
`)

    const result = loadConfig('/test/path')

    expect(result).toEqual({
      base: 'production',
      // provider should not be set since it's invalid
    })
  })

  it('should filter out invalid labels', () => {
    vi.mocked(fs.existsSync).mockImplementation((filePath) => {
      const pathStr = String(filePath)
      if (pathStr.endsWith('.yml') || pathStr.endsWith('.yaml')) {
        return false
      }
      return pathStr.endsWith('.json')
    })
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({
        labels: ['valid', '', null, 123, 'another-valid'],
      }),
    )

    const result = loadConfig('/test/path')

    expect(result).toEqual({
      labels: ['valid', 'another-valid'],
    })
  })

  it('should ignore parse errors and try next file', () => {
    vi.mocked(fs.existsSync).mockImplementation((filePath) => {
      const pathStr = String(filePath)
      // First file (.yml) and third file (.json) exist
      if (pathStr.endsWith('.yaml')) {
        return false
      }
      return pathStr.endsWith('.yml') || pathStr.endsWith('.json')
    })

    let callCount = 0
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        throw new Error('Invalid YAML')
      }
      return JSON.stringify({ base: 'production' })
    })

    const result = loadConfig('/test/path')

    expect(result).toEqual({
      base: 'production',
    })
  })

  it('should return null when all files fail to parse', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error('Parse error')
    })

    const result = loadConfig('/test/path')

    expect(result).toBeNull()
  })

  it('should use current working directory when no basePath provided', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false)
    const originalCwd = process.cwd

    const result = loadConfig()

    expect(result).toBeNull()
    // Verify it attempted to load from cwd
    expect(fs.existsSync).toHaveBeenCalled()

    process.cwd = originalCwd
  })

  it('should handle empty string values', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readFileSync).mockReturnValue(`
base:
head: main
template:
`)

    const result = loadConfig('/test/path')

    expect(result).toEqual({
      head: 'main',
      // base and template should not be set since they're empty
    })
  })

  it('should handle invalid YAML gracefully', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    // Invalid YAML (indentation error) should be caught and return null
    vi.mocked(fs.readFileSync).mockReturnValue(`
base: production
  invalid: indentation
`)

    const result = loadConfig('/test/path')

    // YAML parser will throw on invalid syntax, so should return null
    expect(result).toBeNull()
  })

  it('should parse valid YAML with multiple keys', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readFileSync).mockReturnValue(`
labels:
  - label1
  - label2
base: production
`)

    const result = loadConfig('/test/path')

    expect(result).toEqual({
      base: 'production',
      labels: ['label1', 'label2'],
    })
  })

  it('should skip comment lines when parsing multi-line labels', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readFileSync).mockReturnValue(`
labels:
  - label1
  # This is a comment
  - label2
`)

    const result = loadConfig('/test/path')

    expect(result).toEqual({
      labels: ['label1', 'label2'],
    })
  })
})

describe('getConfigFileNames', () => {
  it('should return the list of supported config file names', () => {
    const fileNames = getConfigFileNames()

    expect(fileNames).toEqual(['.smart-pr-release.yml', '.smart-pr-release.yaml', '.smart-pr-release.json'])
    expect(fileNames).toBeInstanceOf(Array)
  })

  it('should return a readonly array', () => {
    const fileNames = getConfigFileNames()

    // Verify it's an array
    expect(Array.isArray(fileNames)).toBe(true)
    expect(fileNames.length).toBe(3)
  })
})
