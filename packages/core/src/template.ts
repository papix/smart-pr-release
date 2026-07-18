/**
 * Restricted template syntax. Only allowlisted data substitutions, pull request
 * sections, and JSON-string LLM prompts are supported. Template source is never
 * compiled or evaluated as JavaScript.
 */
export const LLM_CALL_PATTERN = /{{\s*llm\s+"/
export const MAX_TEMPLATE_CHARS = 65_536
export const MAX_LLM_CALLS = 4
export const MAX_LLM_PROMPT_CHARS = 4_096

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

type VariableName = 'date' | 'number' | 'title' | 'author'

type TemplateNode =
  | { type: 'text'; value: string }
  | { type: 'variable'; name: VariableName }
  | { type: 'llm'; prompt: string }
  | { type: 'pullRequests'; children: TemplateNode[] }

interface ParseFrame {
  nodes: TemplateNode[]
  inPullRequests: boolean
}

type ParsedTag = TemplateNode | { type: 'openPullRequests' } | { type: 'closePullRequests' }

const PULL_REQUEST_VARIABLES = ['number', 'title', 'author'] as const

function isPullRequestVariable(value: string): value is (typeof PULL_REQUEST_VARIABLES)[number] {
  return PULL_REQUEST_VARIABLES.some((variable) => variable === value)
}

function parseLlmTag(tag: string): Extract<TemplateNode, { type: 'llm' }> {
  const llmMatch = /^llm\s+("(?:\\[\s\S]|[^"\\])*")$/.exec(tag)
  if (!llmMatch?.[1]) {
    throw new Error(`Unsupported template tag: {{ ${tag} }}`)
  }

  let prompt: unknown
  try {
    prompt = JSON.parse(llmMatch[1])
  } catch {
    throw new Error('LLM prompts must be valid JSON strings.')
  }
  if (typeof prompt !== 'string') {
    throw new Error('LLM prompts must be strings.')
  }
  if (prompt.length > MAX_LLM_PROMPT_CHARS) {
    throw new Error(`LLM prompts must not exceed ${MAX_LLM_PROMPT_CHARS} characters.`)
  }
  return { type: 'llm', prompt }
}

function parseTag(tag: string, inPullRequests: boolean): ParsedTag {
  if (tag === '#pullRequests') return { type: 'openPullRequests' }
  if (tag === '/pullRequests') return { type: 'closePullRequests' }
  if (tag === 'date') return { type: 'variable', name: 'date' }
  if (isPullRequestVariable(tag)) {
    if (!inPullRequests) {
      throw new Error(`{{ ${tag} }} is only available inside a {{#pullRequests}} section.`)
    }
    return { type: 'variable', name: tag }
  }
  if (inPullRequests && tag.startsWith('llm')) {
    throw new Error('LLM tags are not allowed inside a {{#pullRequests}} section.')
  }
  return parseLlmTag(tag)
}

function applyParsedTag(tag: ParsedTag, frame: ParseFrame, stack: ParseFrame[]): void {
  if (tag.type === 'openPullRequests') {
    if (frame.inPullRequests) {
      throw new Error('The pullRequests section cannot be nested.')
    }
    const section: Extract<TemplateNode, { type: 'pullRequests' }> = { type: 'pullRequests', children: [] }
    frame.nodes.push(section)
    stack.push({ nodes: section.children, inPullRequests: true })
    return
  }
  if (tag.type === 'closePullRequests') {
    if (!frame.inPullRequests || stack.length === 1) {
      throw new Error('Unexpected {{/pullRequests}} tag.')
    }
    stack.pop()
    return
  }
  frame.nodes.push(tag)
}

function finishParsing(template: string, cursor: number, stack: ParseFrame[]): void {
  if (template.slice(cursor).includes('{{')) {
    throw new Error('Unclosed template tag.')
  }
  const finalFrame = stack.at(-1)
  if (!finalFrame) {
    throw new Error('Invalid template parser state.')
  }
  if (cursor < template.length) {
    finalFrame.nodes.push({ type: 'text', value: template.slice(cursor) })
  }
  if (stack.length !== 1) {
    throw new Error('Unclosed {{#pullRequests}} section.')
  }
}

function parseTemplate(template: string): TemplateNode[] {
  if (template.length > MAX_TEMPLATE_CHARS) {
    throw new Error(`Templates must not exceed ${MAX_TEMPLATE_CHARS} characters.`)
  }
  if (template.includes('<%')) {
    throw new Error('Legacy Eta syntax is not supported. Migrate the template to the restricted {{ ... }} syntax.')
  }

  const root: TemplateNode[] = []
  const stack: ParseFrame[] = [{ nodes: root, inPullRequests: false }]
  const tagPattern = /{{([\s\S]*?)}}/g
  let cursor = 0
  let llmCallCount = 0

  for (const match of template.matchAll(tagPattern)) {
    const matchIndex = match.index
    const frame = stack.at(-1)
    if (!frame) {
      throw new Error('Invalid template parser state.')
    }

    if (matchIndex > cursor) {
      frame.nodes.push({ type: 'text', value: template.slice(cursor, matchIndex) })
    }

    const parsedTag = parseTag(match[1]?.trim() ?? '', frame.inPullRequests)
    if (parsedTag.type === 'llm') {
      llmCallCount += 1
      if (llmCallCount > MAX_LLM_CALLS) {
        throw new Error(`Templates must not contain more than ${MAX_LLM_CALLS} LLM calls.`)
      }
    }
    applyParsedTag(parsedTag, frame, stack)

    cursor = matchIndex + match[0].length
  }

  finishParsing(template, cursor, stack)

  return root
}

async function renderNodes(nodes: TemplateNode[], data: TemplateData, pullRequest?: PullRequestInfo): Promise<string> {
  const parts: string[] = []
  for (const node of nodes) {
    switch (node.type) {
      case 'text':
        parts.push(node.value)
        break
      case 'variable':
        if (node.name === 'date') {
          parts.push(data.date)
          break
        }
        if (!pullRequest) {
          throw new Error(`Template variable ${node.name} requires pull request context.`)
        }
        parts.push(String(pullRequest[node.name]))
        break
      case 'llm':
        if (!data.llm) {
          throw new Error('Template contains an LLM tag but no LLM provider is configured.')
        }
        parts.push(await data.llm(node.prompt))
        break
      case 'pullRequests':
        for (const pr of data.pullRequests) {
          parts.push(await renderNodes(node.children, data, pr))
        }
        break
    }
  }
  return parts.join('')
}

export async function renderTemplate(template: string, data: TemplateData): Promise<string> {
  return await renderNodes(parseTemplate(template), data)
}

export async function renderTemplateWithTitle(template: string, data: TemplateData): Promise<RenderedTemplate> {
  const rendered = await renderTemplate(template, data)
  const lines = rendered.split('\n')
  const title = lines[0] ?? ''
  const body = lines.slice(1).join('\n')
  return { title, body }
}
