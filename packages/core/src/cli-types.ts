import type * as fs from 'node:fs/promises'
import type * as core from '@actions/core'

export interface RunContext {
  env: Record<string, string | undefined>
  argv: string[]
  cwd: () => string
}

export interface RunDeps {
  core: {
    info: typeof core.info
    warning: typeof core.warning
    setOutput: typeof core.setOutput
    setFailed: typeof core.setFailed
    notice?: typeof core.notice
  }
  fs: {
    readFile: typeof fs.readFile
    writeFile: typeof fs.writeFile
    mkdir: typeof fs.mkdir
  }
}

export function createDefaultContext(): RunContext {
  return {
    env: process.env,
    argv: process.argv,
    cwd: () => process.cwd(),
  }
}

export async function createDefaultDeps(): Promise<RunDeps> {
  const core = await import('@actions/core')
  const fs = await import('node:fs/promises')
  return { core, fs }
}
