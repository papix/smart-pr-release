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
  position?: {
    start: { offset?: number }
    end: { offset?: number }
  }
  [key: string]: unknown
}

export interface LLMOutputSpan {
  start: number
  end: number
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
const COMPOSED_URI_TOKEN_PATTERN =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stop unsafe tokens at control characters
  /\b(?:(?:https?|ftp|file|mailto|tel|sms|data|javascript|vbscript|ssh|git|xmpp|irc|ircs|news|nntp|steam|geo|magnet):|[a-z][a-z0-9+.-]*:(?=\/\/))[^\s<>\u0000-\u001F\u007F]*/gi
const COMPOSED_LEXICAL_PATTERNS = [
  { kind: 'scheme', pattern: COMPOSED_URI_TOKEN_PATTERN },
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stop unsafe tokens at control characters
  { kind: 'www', pattern: /\bwww\.[^\s<>\u0000-\u001F\u007F]*/gi },
  { kind: 'issue', pattern: /(^|[^\p{L}\p{N}_])(#[0-9]+)/gu, capture: 2 },
  { kind: 'gh-issue', pattern: /\bGH-[0-9]+/gi },
  { kind: 'mention', pattern: /@[\p{L}\p{N}_-]*/gu },
  { kind: 'bidi', pattern: BIDI_PATTERN },
] as const

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

function overlapsLLMSpan(node: MarkdownNode, spans: LLMOutputSpan[]): boolean {
  const start = node.position?.start.offset
  const end = node.position?.end.offset
  if (start === undefined || end === undefined) return spans.length > 0
  return spans.some((span) => start < span.end && end > span.start)
}

function isFullyCoveredByLLMSpans(node: MarkdownNode, spans: LLMOutputSpan[]): boolean {
  const start = node.position?.start.offset
  const end = node.position?.end.offset
  if (start === undefined || end === undefined) return false
  let coveredUntil = start
  for (const span of [...spans].sort((left, right) => left.start - right.start)) {
    if (span.end <= coveredUntil) continue
    if (span.start > coveredUntil) return false
    coveredUntil = Math.max(coveredUntil, span.end)
    if (coveredUntil >= end) return true
  }
  return coveredUntil >= end
}

function assertNoUnsafeComposedNodes(node: MarkdownNode, spans: LLMOutputSpan[]): void {
  if (!ALLOWED_NODES.has(node.type) && overlapsLLMSpan(node, spans)) {
    throw new LLMOutputPolicyError('LLM_OUTPUT_RESIDUAL_UNSAFE_CONTENT')
  }
  if (
    (node.type === 'code' || node.type === 'inlineCode') &&
    overlapsLLMSpan(node, spans) &&
    !isFullyCoveredByLLMSpans(node, spans)
  ) {
    throw new LLMOutputPolicyError('LLM_OUTPUT_RESIDUAL_UNSAFE_CONTENT')
  }
  for (const child of node.children ?? []) assertNoUnsafeComposedNodes(child, spans)
}

function collectTextLexicalOccurrences(node: MarkdownNode, occurrences: Map<string, number>): void {
  const value = node.value ?? ''
  for (const { kind, pattern, ...options } of COMPOSED_LEXICAL_PATTERNS) {
    const matcher = new RegExp(pattern.source, pattern.flags)
    for (const match of value.matchAll(matcher)) {
      const capture = 'capture' in options ? options.capture : 0
      const matched = match[capture] ?? match[0]
      const signature = `${kind}:${matched.toLocaleLowerCase('en-US')}`
      occurrences.set(signature, (occurrences.get(signature) ?? 0) + 1)
    }
  }
}

function collectLexicalOccurrences(node: MarkdownNode, occurrences: Map<string, number>): void {
  if (node.type === 'text') collectTextLexicalOccurrences(node, occurrences)
  for (const child of node.children ?? []) collectLexicalOccurrences(child, occurrences)
}

function createCompositionBaseline(content: string, spans: LLMOutputSpan[]): string {
  const codeUnits = content.split('')
  for (const span of spans) {
    if (span.start < 0 || span.end < span.start || span.end > content.length) {
      throw new LLMOutputPolicyError('LLM_OUTPUT_RESIDUAL_UNSAFE_CONTENT')
    }
    for (let index = span.start; index < span.end; index += 1) {
      if (codeUnits[index] !== '\n' && codeUnits[index] !== '\r') codeUnits[index] = '\uE000'
    }
  }
  return codeUnits.join('')
}

export function assertSafeComposedLLMOutput(content: string, spans: LLMOutputSpan[]): void {
  if (spans.length === 0) return

  const actualTree = parseMarkdown(content)
  assertNoUnsafeComposedNodes(actualTree, spans)

  const baselineTree = parseMarkdown(createCompositionBaseline(content, spans))
  const actualOccurrences = new Map<string, number>()
  const baselineOccurrences = new Map<string, number>()
  collectLexicalOccurrences(actualTree, actualOccurrences)
  collectLexicalOccurrences(baselineTree, baselineOccurrences)
  for (const [occurrence, count] of actualOccurrences) {
    if (count > (baselineOccurrences.get(occurrence) ?? 0)) {
      throw new LLMOutputPolicyError('LLM_OUTPUT_RESIDUAL_UNSAFE_CONTENT')
    }
  }
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
