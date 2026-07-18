import { existsSync, realpathSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'

export function resolveTemplatePath(templatePath: string, workspace: string): string {
  const resolvedPath = resolve(workspace, templatePath)
  if (!existsSync(resolvedPath)) {
    throw new Error(`Template file not found: ${resolvedPath}`)
  }

  const realWorkspace = realpathSync(workspace)
  const realTemplatePath = realpathSync(resolvedPath)
  const relativePath = relative(realWorkspace, realTemplatePath)
  if (relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    throw new Error('Template path resolves outside the current workspace')
  }

  return realTemplatePath
}
