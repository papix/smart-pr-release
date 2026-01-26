import { Eta, type EtaConfig } from 'eta'

const etaConfig: Partial<EtaConfig> = {
  autoEscape: false,
}
const eta = new Eta(etaConfig)

/**
 * Regex pattern to detect LLM calls in Eta templates.
 * Matches: it.llm(, it?.llm(, it["llm"](, it['llm'](
 * Also handles whitespace variations (e.g., 'it .llm(', 'it ?. llm(')
 */
export const LLM_CALL_PATTERN = /\bit\s*(?:\?\s*)?(?:\.\s*llm|\[\s*['"]llm['"]\s*\])\s*\(/

/**
 * Check if a template contains LLM calls that require an AI provider.
 */
export function hasLLMCalls(templateContent: string): boolean {
  return LLM_CALL_PATTERN.test(templateContent)
}

// Escape Markdown special characters to prevent formatting issues
// Slashes are not escaped to preserve URLs
export function escapeMarkdown(text: string): string {
  return text.replace(/([*_`~[\]()#+\-.!\\|{}])/g, '\\$1')
}

export interface PullRequestInfo {
  number: number
  title: string
  author: string
}

export interface TemplateData {
  date: string
  pullRequests: PullRequestInfo[]
  llm?: (prompt: string) => Promise<string>
}

export interface RenderedTemplate {
  title: string
  body: string
}

export async function renderTemplate(template: string, data: TemplateData): Promise<string> {
  return await eta.renderStringAsync(template, data)
}

export async function renderTemplateWithTitle(template: string, data: TemplateData): Promise<RenderedTemplate> {
  const rendered = await renderTemplate(template, data)
  const lines = rendered.split('\n')
  const title = lines[0]?.trim() || 'Release'
  const body = lines.slice(1).join('\n').trim()
  return { title, body }
}
