import { describe, expect, it } from 'vitest'
import {
  assertSafeComposedLLMOutput,
  MAX_LLM_OUTPUT_CHARS,
  sanitizeLLMOutput,
  validateLLMOutputNode,
} from './sanitize-llm-output.js'

describe('assertSafeComposedLLMOutput', () => {
  it('accepts content without LLM spans and trusted unsafe content outside an LLM span', () => {
    expect(() => assertSafeComposedLLMOutput('https://trusted.example', [])).not.toThrow()
    expect(() => assertSafeComposedLLMOutput('https://trusted.example safe', [{ start: 24, end: 28 }])).not.toThrow()
    expect(() => assertSafeComposedLLMOutput('safe\ntext', [{ start: 0, end: 9 }])).not.toThrow()
  })

  it.each([
    ['**safe** https://trusted.example', { start: 0, end: 8 }],
    ['**safe**https://trusted.example', { start: 0, end: 8 }],
    ['**safe**WWW.example', { start: 0, end: 8 }],
    ['**safe**#123', { start: 0, end: 8 }],
    ['**safe**GH-123', { start: 0, end: 8 }],
    ['# safe\n\nhttps://trusted.example', { start: 0, end: 6 }],
    ['- safe\n\n@trusted #123', { start: 0, end: 6 }],
  ])('accepts safe LLM Markdown before trusted lexical content', (content, span) => {
    expect(() => assertSafeComposedLLMOutput(content, [span])).not.toThrow()
  })

  it('rejects unsafe lexical and structural content composed across an LLM boundary', () => {
    expect(() => assertSafeComposedLLMOutput('https://example.com', [{ start: 5, end: 6 }])).toThrow(
      'LLM_OUTPUT_RESIDUAL_UNSAFE_CONTENT',
    )
    expect(() => assertSafeComposedLLMOutput('[safe](https://example.com)', [{ start: 1, end: 5 }])).toThrow(
      'LLM_OUTPUT_RESIDUAL_UNSAFE_CONTENT',
    )
  })

  it('rejects lexical occurrence substitution through a cross-boundary code fence', () => {
    const llmOutput = '://attacker.example\n\n```\nx\n```'
    const content = `https${llmOutput}https://trusted.example`

    expect(() => assertSafeComposedLLMOutput(content, [{ start: 5, end: 5 + llmOutput.length }])).toThrow(
      'LLM_OUTPUT_RESIDUAL_UNSAFE_CONTENT',
    )
  })

  it('rejects code nodes that consume both LLM and trusted content', () => {
    expect(() => assertSafeComposedLLMOutput('`safe` trusted', [{ start: 1, end: 5 }])).toThrow(
      'LLM_OUTPUT_RESIDUAL_UNSAFE_CONTENT',
    )
  })

  it.each([[{ start: -1, end: 0 }], [{ start: 2, end: 1 }], [{ start: 0, end: 2 }]])(
    'rejects an invalid LLM span',
    (span) => {
      expect(() => assertSafeComposedLLMOutput('x', [span])).toThrow('LLM_OUTPUT_RESIDUAL_UNSAFE_CONTENT')
    },
  )
})

describe('sanitizeLLMOutput', () => {
  it('preserves allowlisted Markdown including nested lists and hard breaks', () => {
    const input =
      '# Heading\n\n- **Bold** and *emphasis*\n  - `inline`  \n    next\n\n```ts meta\nconst url = "https://example.com/@user#1"\n```\n\n---'
    const result = sanitizeLLMOutput(input)
    expect(result.content).toContain('# Heading')
    expect(result.content).toContain('  * `inline`\\\n    next')
    expect(result.content).toContain('https://example.com/@user#1')
    expect(result.transformationCount).toBe(0)
  })

  it('unwraps quotes and links, converts images and HTML, and removes definitions', () => {
    const input =
      '> [safe **label**][ref]\n\n![alt @team](https://example.com/image.png)\n\n<div>@owner & ok</div>\n\n[ref]: https://example.com'
    const result = sanitizeLLMOutput(input)
    expect(result.content).toContain('safe **label**')
    expect(result.content).toContain('alt ＠team')
    expect(result.content).toContain('＜div＞＠owner ＆ ok＜/div＞')
    expect(result.content).not.toContain('https://')
    expect(result.transformationCount).toBeGreaterThanOrEqual(6)
  })

  it('neutralizes decoded entities, escapes, URL forms, mentions, and issue references case-insensitively', () => {
    const input = String.raw`&#64;entity \@escaped HTTPS://example.com mailto:user@example.com WWW.example.com #123 gh-456`
    const result = sanitizeLLMOutput(input)
    expect(result.content).toContain('＠entity ＠escaped HTTPS：//example.com')
    expect(result.content).toContain('mailto：user＠example.com WWW．example.com ＃123 gh－456')
    expect(result.transformationCount).toBe(8)
  })

  it('replaces bidi controls everywhere but otherwise preserves code values', () => {
    const result = sanitizeLLMOutput(
      'text\u202e\n\n`https://x/@a#1\u2066`\n\n```js meta\u202a\n@x https://x #1\u2069\n```',
    )
    expect(result.content).toContain('text�')
    expect(result.content).toContain('`https://x/@a#1�`')
    expect(result.content).toContain('@x https://x #1�')
    expect(result.content).not.toMatch(/[\u202A-\u202E\u2066-\u2069]/)
    expect(result.transformationCount).toBe(4)
  })

  it('is idempotent after canonical serialization', () => {
    const first = sanitizeLLMOutput('See [WWW.example.com](https://example.com) @team #12')
    const second = sanitizeLLMOutput(first.content)
    expect(second).toEqual({ content: first.content, transformationCount: 0 })
  })

  it.each([
    ['', 'LLM_OUTPUT_EMPTY'],
    [' \n ', 'LLM_OUTPUT_EMPTY'],
    ['x'.repeat(MAX_LLM_OUTPUT_CHARS + 1), 'LLM_OUTPUT_TOO_LARGE'],
    ['bad\u0000control', 'LLM_OUTPUT_INVALID_CONTROL'],
  ])('rejects invalid output with a stable code', (input, code) => {
    expect(() => sanitizeLLMOutput(input)).toThrow(code)
  })

  it('rejects an unknown AST node', () => {
    expect(() => validateLLMOutputNode({ type: 'delete', children: [] })).toThrow('LLM_OUTPUT_UNSUPPORTED_NODE')
  })

  it('accepts allowlisted leaf and empty container nodes in the defensive AST validator', () => {
    expect(() => validateLLMOutputNode({ type: 'break' })).not.toThrow()
    expect(() => validateLLMOutputNode({ type: 'paragraph' })).not.toThrow()
  })

  it('accepts missing optional values in transformed defensive AST nodes', () => {
    expect(() => validateLLMOutputNode({ type: 'blockquote' })).not.toThrow()
    expect(() => validateLLMOutputNode({ type: 'image' })).not.toThrow()
    expect(() => validateLLMOutputNode({ type: 'html' })).not.toThrow()
    expect(() => validateLLMOutputNode({ type: 'text' })).not.toThrow()
  })

  it('accepts the exact input boundary', () => {
    expect(sanitizeLLMOutput('x'.repeat(MAX_LLM_OUTPUT_CHARS)).content).toHaveLength(MAX_LLM_OUTPUT_CHARS)
  })

  it('rejects output that exceeds the limit only after canonical serialization', () => {
    expect(() => sanitizeLLMOutput('#'.repeat(MAX_LLM_OUTPUT_CHARS))).toThrow('LLM_OUTPUT_TOO_LARGE')
  })
})
