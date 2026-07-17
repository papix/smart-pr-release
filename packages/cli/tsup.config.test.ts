import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, type Options } from 'tsup'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import config from './tsup.config.js'

const cliDirectory = fileURLToPath(new URL('.', import.meta.url))
const entry = join(cliDirectory, 'src/index.ts')
let temporaryDirectory: string
let bundledCli: string

beforeAll(async () => {
  temporaryDirectory = await mkdtemp(join(tmpdir(), 'smart-pr-release-cli-test-'))
  bundledCli = join(temporaryDirectory, 'index.js')

  await build({
    ...(config as Options),
    entry: [entry],
    outDir: temporaryDirectory,
    clean: true,
    silent: true,
  })

  await writeFile(join(temporaryDirectory, '.env.local'), 'SMART_PR_RELEASE_TEST=1\n')
})

afterAll(async () => {
  await rm(temporaryDirectory, { recursive: true, force: true })
})

describe('CLI production bundle', () => {
  it('starts as ESM without dotenv diagnostics', () => {
    const env = { ...process.env }
    delete env.CI

    const result = spawnSync(process.execPath, [bundledCli, '--help'], {
      cwd: temporaryDirectory,
      encoding: 'utf8',
      env,
    })

    expect(result.status).toBe(0)
    expect(result.error).toBeUndefined()
    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('Usage: smart-pr-release')
    expect(result.stdout).not.toContain('[dotenv@')
    expect(result.stdout).not.toContain('Dynamic require')
  })
})
