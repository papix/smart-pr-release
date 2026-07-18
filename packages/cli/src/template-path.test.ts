import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveTemplatePath } from './template-path.js'

describe('resolveTemplatePath', () => {
  let temporaryRoot: string | undefined

  afterEach(() => {
    if (temporaryRoot) {
      rmSync(temporaryRoot, { recursive: true, force: true })
      temporaryRoot = undefined
    }
  })

  function createFixture(): { workspace: string; template: string; outsideTemplate: string } {
    temporaryRoot = mkdtempSync(join(tmpdir(), 'smart-pr-release-template-'))
    const workspace = join(temporaryRoot, 'workspace')
    const template = join(workspace, 'templates', 'release.md')
    const outsideTemplate = join(temporaryRoot, 'outside.md')
    mkdirSync(join(workspace, 'templates'), { recursive: true })
    writeFileSync(template, '# Release')
    writeFileSync(outsideTemplate, '# Outside')
    return { workspace, template, outsideTemplate }
  }

  it('resolves a template inside the workspace', () => {
    const { workspace, template } = createFixture()

    expect(resolveTemplatePath('templates/release.md', workspace)).toBe(realpathSync(template))
  })

  it('rejects a parent-directory traversal', () => {
    const { workspace } = createFixture()

    expect(() => resolveTemplatePath('../outside.md', workspace)).toThrow('outside the current workspace')
  })

  it('rejects an absolute path outside the workspace', () => {
    const { workspace, outsideTemplate } = createFixture()

    expect(() => resolveTemplatePath(outsideTemplate, workspace)).toThrow('outside the current workspace')
  })

  it('rejects a symlink that resolves outside the workspace', () => {
    const { workspace, outsideTemplate } = createFixture()
    const symlink = join(workspace, 'templates', 'outside.md')
    symlinkSync(outsideTemplate, symlink)

    expect(() => resolveTemplatePath('templates/outside.md', workspace)).toThrow('outside the current workspace')
  })

  it('allows a symlink that resolves inside the workspace', () => {
    const { workspace, template } = createFixture()
    const symlink = join(workspace, 'templates', 'alias.md')
    symlinkSync(template, symlink)

    expect(resolveTemplatePath('templates/alias.md', workspace)).toBe(realpathSync(template))
  })

  it('reports a missing template', () => {
    const { workspace } = createFixture()

    expect(() => resolveTemplatePath('templates/missing.md', workspace)).toThrow('Template file not found')
  })
})
