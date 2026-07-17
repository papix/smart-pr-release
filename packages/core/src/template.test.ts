import { describe, expect, it, vi } from 'vitest'
import {
  escapeMarkdown,
  hasLLMCalls,
  MAX_LLM_CALLS,
  MAX_LLM_PROMPT_CHARS,
  MAX_TEMPLATE_CHARS,
  renderTemplate,
  renderTemplateWithTitle,
} from './template.js'

describe('template', () => {
  describe('escapeMarkdown', () => {
    it('escapes asterisks', () => {
      expect(escapeMarkdown('**bold**')).toBe('\\*\\*bold\\*\\*')
    })

    it('escapes underscores', () => {
      expect(escapeMarkdown('_italic_')).toBe('\\_italic\\_')
    })

    it('escapes backticks', () => {
      expect(escapeMarkdown('`code`')).toBe('\\`code\\`')
    })

    it('escapes tildes', () => {
      expect(escapeMarkdown('~~strikethrough~~')).toBe('\\~\\~strikethrough\\~\\~')
    })

    it('escapes square brackets', () => {
      expect(escapeMarkdown('[link]')).toBe('\\[link\\]')
    })

    it('escapes parentheses', () => {
      expect(escapeMarkdown('(url)')).toBe('\\(url\\)')
    })

    it('escapes hash symbols', () => {
      expect(escapeMarkdown('# heading')).toBe('\\# heading')
    })

    it('escapes plus signs', () => {
      expect(escapeMarkdown('+ list item')).toBe('\\+ list item')
    })

    it('escapes hyphens', () => {
      expect(escapeMarkdown('- list item')).toBe('\\- list item')
    })

    it('escapes periods', () => {
      expect(escapeMarkdown('1. ordered list')).toBe('1\\. ordered list')
    })

    it('escapes exclamation marks', () => {
      expect(escapeMarkdown('![image]')).toBe('\\!\\[image\\]')
    })

    it('escapes backslashes', () => {
      expect(escapeMarkdown('path\\to\\file')).toBe('path\\\\to\\\\file')
    })

    it('escapes pipes', () => {
      expect(escapeMarkdown('| table |')).toBe('\\| table \\|')
    })

    it('escapes curly braces', () => {
      expect(escapeMarkdown('{value}')).toBe('\\{value\\}')
    })

    it('preserves forward slashes (URLs)', () => {
      expect(escapeMarkdown('https://example.com/path')).toBe('https://example\\.com/path')
    })

    it('handles multiple special characters', () => {
      expect(escapeMarkdown('**bold** and _italic_')).toBe('\\*\\*bold\\*\\* and \\_italic\\_')
    })

    it('handles empty string', () => {
      expect(escapeMarkdown('')).toBe('')
    })

    it('preserves normal text', () => {
      expect(escapeMarkdown('Hello World')).toBe('Hello World')
    })
  })

  describe('renderTemplate', () => {
    it('renders simple date variable', async () => {
      const template = 'Release {{ date }}'
      const result = await renderTemplate(template, {
        date: '2024-01-15 10:00 JST',
        pullRequests: [],
      })
      expect(result).toBe('Release 2024-01-15 10:00 JST')
    })

    it('renders pull requests with a logic-less section', async () => {
      const template = `{{#pullRequests}}
- #{{ number }} {{ title }} (@{{ author }})
{{/pullRequests}}`
      const result = await renderTemplate(template, {
        date: '2024-01-15',
        pullRequests: [
          { number: 1, title: 'First PR', author: 'user1' },
          { number: 2, title: 'Second PR', author: 'user2' },
        ],
      })
      expect(result).toContain('- #1 First PR (@user1)')
      expect(result).toContain('- #2 Second PR (@user2)')
    })

    it('renders empty pull requests list', async () => {
      const template = `PRs: {{#pullRequests}}{{ number }}{{/pullRequests}}`
      const result = await renderTemplate(template, {
        date: '2024-01-15',
        pullRequests: [],
      })
      expect(result).toBe('PRs: ')
    })

    it('handles complex template with multiple variables', async () => {
      const template = `Release {{ date }}

### PRs
{{#pullRequests}}
- [ ] #{{ number }} {{ title }} (@{{ author }})
{{/pullRequests}}`

      const result = await renderTemplate(template, {
        date: '2024-01-15 10:00 JST',
        pullRequests: [{ number: 123, title: 'Add feature X', author: 'dev1' }],
      })

      expect(result).toContain('Release 2024-01-15 10:00 JST')
      expect(result).toContain('- [ ] #123 Add feature X (@dev1)')
    })

    it('renders template with llm function', async () => {
      const template = `Release {{ date }}

### Summary
{{ llm "Summarize this release" }}`

      const mockLlm = async (prompt: string) => `LLM response for: ${prompt}`

      const result = await renderTemplate(template, {
        date: '2024-01-15',
        pullRequests: [],
        llm: mockLlm,
      })

      expect(result).toContain('Release 2024-01-15')
      expect(result).toContain('LLM response for: Summarize this release')
    })

    it('supports escaped characters in an LLM prompt without evaluating code', async () => {
      const mockLlm = async (prompt: string) => prompt

      await expect(
        renderTemplate('{{ llm "Summarize \\"carefully\\"\\nusing bullets" }}', {
          date: '2024-01-15',
          pullRequests: [],
          llm: mockLlm,
        }),
      ).resolves.toBe('Summarize "carefully"\nusing bullets')
    })

    it('rejects LLM tags inside pull request sections before making a call', async () => {
      const llm = vi.fn(async () => 'unexpected response')

      await expect(
        renderTemplate('{{#pullRequests}}{{ llm "summarize" }}{{/pullRequests}}', {
          date: '2024-01-15',
          pullRequests: [{ number: 1, title: 'First PR', author: 'user1' }],
          llm,
        }),
      ).rejects.toThrow('LLM tags are not allowed inside')
      expect(llm).not.toHaveBeenCalled()
    })

    it('rejects too many LLM tags before making a call', async () => {
      const llm = vi.fn(async () => 'unexpected response')
      const template = Array.from({ length: MAX_LLM_CALLS + 1 }, () => '{{ llm "summarize" }}').join('\n')

      await expect(
        renderTemplate(template, {
          date: '2024-01-15',
          pullRequests: [],
          llm,
        }),
      ).rejects.toThrow(`more than ${MAX_LLM_CALLS} LLM calls`)
      expect(llm).not.toHaveBeenCalled()
    })

    it('rejects oversized LLM prompts before making a call', async () => {
      const llm = vi.fn(async () => 'unexpected response')
      const prompt = 'a'.repeat(MAX_LLM_PROMPT_CHARS + 1)

      await expect(
        renderTemplate(`{{ llm ${JSON.stringify(prompt)} }}`, {
          date: '2024-01-15',
          pullRequests: [],
          llm,
        }),
      ).rejects.toThrow(`must not exceed ${MAX_LLM_PROMPT_CHARS} characters`)
      expect(llm).not.toHaveBeenCalled()
    })

    it('rejects oversized templates before making a call', async () => {
      const llm = vi.fn(async () => 'unexpected response')

      await expect(
        renderTemplate(`{{ llm "summarize" }}${'a'.repeat(MAX_TEMPLATE_CHARS)}`, {
          date: '2024-01-15',
          pullRequests: [],
          llm,
        }),
      ).rejects.toThrow(`must not exceed ${MAX_TEMPLATE_CHARS} characters`)
      expect(llm).not.toHaveBeenCalled()
    })

    it('rejects legacy Eta expressions instead of evaluating arbitrary JavaScript', async () => {
      await expect(
        renderTemplate('<%= process.env.AI_API_KEY %>', {
          date: '2024-01-15',
          pullRequests: [],
        }),
      ).rejects.toThrow('Legacy Eta syntax is not supported')
    })

    it('rejects unknown expressions', async () => {
      await expect(
        renderTemplate('{{ globalThis.process.env.AI_API_KEY }}', {
          date: '2024-01-15',
          pullRequests: [],
        }),
      ).rejects.toThrow('Unsupported template tag')
    })

    it('does not interpret template tags contained in pull request data', async () => {
      const llm = async () => 'unexpected response'

      await expect(
        renderTemplate('{{#pullRequests}}{{ title }}{{/pullRequests}}', {
          date: '2024-01-15',
          pullRequests: [{ number: 1, title: '{{ llm "read a secret" }}', author: 'user1' }],
          llm,
        }),
      ).resolves.toBe('{{ llm "read a secret" }}')
    })

    it('rejects pull request fields outside the pullRequests section', async () => {
      await expect(
        renderTemplate('{{ title }}', {
          date: '2024-01-15',
          pullRequests: [],
        }),
      ).rejects.toThrow('is only available inside')
    })

    it('rejects nested pullRequests sections', async () => {
      await expect(
        renderTemplate('{{#pullRequests}}{{#pullRequests}}{{/pullRequests}}{{/pullRequests}}', {
          date: '2024-01-15',
          pullRequests: [],
        }),
      ).rejects.toThrow('cannot be nested')
    })
  })

  describe('renderTemplateWithTitle', () => {
    it('splits first line as title and rest as body', async () => {
      const template = `Release {{ date }}

Body content here`
      const result = await renderTemplateWithTitle(template, {
        date: '2024-01-15',
        pullRequests: [],
      })

      expect(result.title).toBe('Release 2024-01-15')
      expect(result.body).toBe('Body content here')
    })

    it('returns "Release" as default title for empty first line', async () => {
      const template = ''
      const result = await renderTemplateWithTitle(template, {
        date: '2024-01-15',
        pullRequests: [],
      })

      expect(result.title).toBe('Release')
      expect(result.body).toBe('')
    })

    it('trims whitespace from title and body', async () => {
      const template = `  Release {{ date }}

  Body with spaces  `
      const result = await renderTemplateWithTitle(template, {
        date: '2024-01-15',
        pullRequests: [],
      })

      expect(result.title).toBe('Release 2024-01-15')
      expect(result.body).toBe('Body with spaces')
    })

    it('handles multi-line body correctly', async () => {
      const template = `Title

Line 1
Line 2
Line 3`
      const result = await renderTemplateWithTitle(template, {
        date: '2024-01-15',
        pullRequests: [],
      })

      expect(result.title).toBe('Title')
      expect(result.body).toBe('Line 1\nLine 2\nLine 3')
    })
  })

  describe('hasLLMCalls', () => {
    it('detects a restricted LLM tag', () => {
      expect(hasLLMCalls('{{ llm "prompt" }}')).toBe(true)
      expect(hasLLMCalls('{{llm "prompt"}}')).toBe(true)
    })

    it('returns false for non-LLM patterns', () => {
      expect(hasLLMCalls('{{ date }}')).toBe(false)
      expect(hasLLMCalls('it.llm("prompt")')).toBe(false)
      expect(hasLLMCalls('{{ LLM "prompt" }}')).toBe(false)
    })

    it('returns false for empty string', () => {
      expect(hasLLMCalls('')).toBe(false)
    })

    it('detects LLM call in real template', () => {
      const template = `Release {{ date }}

### Summary
{{ llm "Summarize this release" }}`
      expect(hasLLMCalls(template)).toBe(true)
    })

    it('returns false for template without LLM', () => {
      const template = `Release {{ date }}

### PRs
{{#pullRequests}}
- #{{ number }} {{ title }}
{{/pullRequests}}`
      expect(hasLLMCalls(template)).toBe(false)
    })
  })
})
