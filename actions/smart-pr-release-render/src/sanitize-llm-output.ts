import { fromMarkdown } from 'mdast-util-from-markdown'
import { toMarkdown } from 'mdast-util-to-markdown'

export const MAX_LLM_OUTPUT_CHARS = 16_384

export type LLMOutputErrorCode =
  | 'LLM_OUTPUT_EMPTY'
  | 'LLM_OUTPUT_TOO_LARGE'
  | 'LLM_OUTPUT_INVALID_CONTROL'
  | 'LLM_OUTPUT_PARSE_FAILED'
  | 'LLM_OUTPUT_UNSUPPORTED_NODE'
  | 'LLM_OUTPUT_SERIALIZE_FAILED'
  | 'LLM_OUTPUT_RESIDUAL_UNSAFE_CONTENT'

export class LLMOutputPolicyError extends Error {
  readonly code: LLMOutputErrorCode

  constructor(code: LLMOutputErrorCode) {
    super(code)
    this.name = 'LLMOutputPolicyError'
    this.code = code
  }
}

export interface MarkdownNode {
  type: string
  value?: string
  alt?: string | null
  lang?: string | null
  meta?: string | null
  children?: MarkdownNode[]
  [key: string]: unknown
}

export interface SanitizedLLMOutput {
  content: string
  transformationCount: number
}

const ALLOWED_NODES = new Set([
  'root',
  'paragraph',
  'heading',
  'list',
  'listItem',
  'emphasis',
  'strong',
  'inlineCode',
  'code',
  'break',
  'thematicBreak',
  'text',
])
const CONTAINER_NODES = new Set(['root', 'paragraph', 'heading', 'list', 'listItem', 'emphasis', 'strong'])
const BIDI_PATTERN = /[\u202A-\u202E\u2066-\u2069]/g
// biome-ignore lint/suspicious/noControlCharactersInRegex: fail-closed validation of untrusted model output
const INVALID_CONTROL_PATTERN = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/
const URI_SCHEME_PATTERN =
  /\b(?:(?:https?|ftp|file|mailto|tel|sms|data|javascript|vbscript|ssh|git|xmpp|irc|ircs|news|nntp|steam|geo|magnet):|[a-z][a-z0-9+.-]*:(?=\/\/))/gi
const WWW_PATTERN = /\bwww\./gi
const ISSUE_PATTERN = /(^|[^\p{L}\p{N}_])#(?=\d+)/gu
const GH_ISSUE_PATTERN = /\bGH-(?=\d+)/gi

function replaceCounted(
  value: string,
  pattern: RegExp,
  replacement: string | ((match: string, ...args: string[]) => string),
) {
  let count = 0
  const output = value.replace(pattern, (...args) => {
    count += 1
    return typeof replacement === 'string' ? replacement : replacement(args[0], ...args.slice(1))
  })
  return { output, count }
}

function replaceBidi(value: string): { output: string; count: number } {
  return replaceCounted(value, BIDI_PATTERN, '�')
}

function sanitizeText(value: string): { output: string; count: number } {
  let output = value
  let count = 0
  const apply = (pattern: RegExp, replacement: string | ((match: string, ...args: string[]) => string)) => {
    const result = replaceCounted(output, pattern, replacement)
    output = result.output
    count += result.count
  }
  apply(BIDI_PATTERN, '�')
  apply(URI_SCHEME_PATTERN, (match) => match.replace(':', '：'))
  apply(WWW_PATTERN, (match) => `${match.slice(0, -1)}．`)
  apply(ISSUE_PATTERN, (_match, prefix) => `${prefix}＃`)
  apply(GH_ISSUE_PATTERN, (match) => `${match.slice(0, 2)}－`)
  apply(/@/g, '＠')
  return { output, count }
}

function transformNode(node: MarkdownNode): { nodes: MarkdownNode[]; count: number } {
  switch (node.type) {
    case 'blockquote':
    case 'link':
    case 'linkReference': {
      const transformed = transformChildren(node.children ?? [])
      return { nodes: transformed.nodes, count: transformed.count + 1 }
    }
    case 'image':
    case 'imageReference': {
      const sanitized = sanitizeText(node.alt ?? '')
      return {
        nodes: sanitized.output ? [{ type: 'text', value: sanitized.output }] : [],
        count: sanitized.count + 1,
      }
    }
    case 'definition':
      return { nodes: [], count: 1 }
    case 'html': {
      const value = (node.value ?? '').replaceAll('&', '＆').replaceAll('<', '＜').replaceAll('>', '＞')
      const sanitized = sanitizeText(value)
      return { nodes: [{ type: 'text', value: sanitized.output }], count: sanitized.count + 1 }
    }
    case 'text': {
      const sanitized = sanitizeText(node.value ?? '')
      return { nodes: [{ ...node, value: sanitized.output }], count: sanitized.count }
    }
    case 'code':
    case 'inlineCode':
      return sanitizeCodeNode(node)
    default:
      return transformAllowedNode(node)
  }
}

function sanitizeCodeNode(node: MarkdownNode): { nodes: MarkdownNode[]; count: number } {
  let count = 0
  const copy = { ...node }
  for (const key of ['value', 'lang', 'meta'] as const) {
    const value = copy[key]
    if (typeof value === 'string') {
      const sanitized = replaceBidi(value)
      copy[key] = sanitized.output
      count += sanitized.count
    }
  }
  return { nodes: [copy], count }
}

function transformAllowedNode(node: MarkdownNode): { nodes: MarkdownNode[]; count: number } {
  if (!ALLOWED_NODES.has(node.type)) throw new LLMOutputPolicyError('LLM_OUTPUT_UNSUPPORTED_NODE')
  if (!CONTAINER_NODES.has(node.type)) return { nodes: [{ ...node }], count: 0 }
  const transformed = transformChildren(node.children ?? [])
  return { nodes: [{ ...node, children: transformed.nodes }], count: transformed.count }
}

export function validateLLMOutputNode(node: MarkdownNode): void {
  transformNode(node)
}

function transformChildren(children: MarkdownNode[]): { nodes: MarkdownNode[]; count: number } {
  const nodes: MarkdownNode[] = []
  let count = 0
  for (const child of children) {
    const transformed = transformNode(child)
    nodes.push(...transformed.nodes)
    count += transformed.count
  }
  return { nodes, count }
}

function parseMarkdown(content: string): MarkdownNode {
  try {
    return fromMarkdown(content) as MarkdownNode
  } catch {
    throw new LLMOutputPolicyError('LLM_OUTPUT_PARSE_FAILED')
  }
}

function assertSafeTree(node: MarkdownNode): void {
  if (!ALLOWED_NODES.has(node.type)) throw new LLMOutputPolicyError('LLM_OUTPUT_RESIDUAL_UNSAFE_CONTENT')
  for (const key of ['value', 'lang', 'meta'] as const) {
    const value = node[key]
    if (typeof value !== 'string') continue
    if (BIDI_PATTERN.test(value)) throw new LLMOutputPolicyError('LLM_OUTPUT_RESIDUAL_UNSAFE_CONTENT')
    BIDI_PATTERN.lastIndex = 0
    if (node.type !== 'code' && node.type !== 'inlineCode') {
      if (
        URI_SCHEME_PATTERN.test(value) ||
        WWW_PATTERN.test(value) ||
        ISSUE_PATTERN.test(value) ||
        GH_ISSUE_PATTERN.test(value) ||
        value.includes('@')
      ) {
        URI_SCHEME_PATTERN.lastIndex = 0
        WWW_PATTERN.lastIndex = 0
        ISSUE_PATTERN.lastIndex = 0
        GH_ISSUE_PATTERN.lastIndex = 0
        throw new LLMOutputPolicyError('LLM_OUTPUT_RESIDUAL_UNSAFE_CONTENT')
      }
      URI_SCHEME_PATTERN.lastIndex = 0
      WWW_PATTERN.lastIndex = 0
      ISSUE_PATTERN.lastIndex = 0
      GH_ISSUE_PATTERN.lastIndex = 0
    }
  }
  for (const child of node.children ?? []) assertSafeTree(child)
}

export function sanitizeLLMOutput(content: string): SanitizedLLMOutput {
  if (content.length === 0 || content.trim().length === 0) throw new LLMOutputPolicyError('LLM_OUTPUT_EMPTY')
  if (content.length > MAX_LLM_OUTPUT_CHARS) throw new LLMOutputPolicyError('LLM_OUTPUT_TOO_LARGE')
  if (INVALID_CONTROL_PATTERN.test(content)) throw new LLMOutputPolicyError('LLM_OUTPUT_INVALID_CONTROL')

  const transformed = transformNode(parseMarkdown(content))
  const root = transformed.nodes[0]
  if (root?.type !== 'root') throw new LLMOutputPolicyError('LLM_OUTPUT_PARSE_FAILED')

  let serialized: string
  try {
    serialized = toMarkdown(root as never).trim()
  } catch {
    throw new LLMOutputPolicyError('LLM_OUTPUT_SERIALIZE_FAILED')
  }
  if (serialized.length > MAX_LLM_OUTPUT_CHARS) throw new LLMOutputPolicyError('LLM_OUTPUT_TOO_LARGE')
  if (serialized.length === 0) throw new LLMOutputPolicyError('LLM_OUTPUT_EMPTY')
  assertSafeTree(parseMarkdown(serialized))
  return { content: serialized, transformationCount: transformed.count }
}
