import { describe, expect, it } from 'vitest'
import { escapeMarkdown, hasLLMCalls, renderTemplate, renderTemplateWithTitle } from './template.js'

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
      const template = 'Release <%= it.date %>'
      const result = await renderTemplate(template, {
        date: '2024-01-15 10:00 JST',
        pullRequests: [],
      })
      expect(result).toBe('Release 2024-01-15 10:00 JST')
    })

    it('renders pull requests with forEach', async () => {
      const template = `<% it.pullRequests.forEach(pr => { %>
- #<%= pr.number %> <%= pr.title %> (@<%= pr.author %>)
<% }) %>`
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
      const template = `PRs: <% it.pullRequests.forEach(pr => { %><%= pr.number %><% }) %>`
      const result = await renderTemplate(template, {
        date: '2024-01-15',
        pullRequests: [],
      })
      expect(result).toBe('PRs: ')
    })

    it('handles complex template with multiple variables', async () => {
      const template = `Release <%= it.date %>

### PRs
<% it.pullRequests.forEach(pr => { %>
- [ ] #<%= pr.number %> <%= pr.title %> (@<%= pr.author %>)
<% }) %>`

      const result = await renderTemplate(template, {
        date: '2024-01-15 10:00 JST',
        pullRequests: [{ number: 123, title: 'Add feature X', author: 'dev1' }],
      })

      expect(result).toContain('Release 2024-01-15 10:00 JST')
      expect(result).toContain('- [ ] #123 Add feature X (@dev1)')
    })

    it('renders template with llm function', async () => {
      const template = `Release <%= it.date %>

### Summary
<%~ await it.llm('Summarize this release') %>`

      const mockLlm = async (prompt: string) => `LLM response for: ${prompt}`

      const result = await renderTemplate(template, {
        date: '2024-01-15',
        pullRequests: [],
        llm: mockLlm,
      })

      expect(result).toContain('Release 2024-01-15')
      expect(result).toContain('LLM response for: Summarize this release')
    })
  })

  describe('renderTemplateWithTitle', () => {
    it('splits first line as title and rest as body', async () => {
      const template = `Release <%= it.date %>

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
      const template = `  Release <%= it.date %>

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
    it('detects standard LLM call', () => {
      expect(hasLLMCalls('it.llm(')).toBe(true)
      expect(hasLLMCalls('await it.llm("prompt")')).toBe(true)
    })

    it('detects LLM call with whitespace', () => {
      expect(hasLLMCalls('it .llm(')).toBe(true)
      expect(hasLLMCalls('it. llm(')).toBe(true)
      expect(hasLLMCalls('it . llm (')).toBe(true)
    })

    it('detects optional chaining', () => {
      expect(hasLLMCalls('it?.llm(')).toBe(true)
      expect(hasLLMCalls('it ?.llm(')).toBe(true)
      expect(hasLLMCalls('it ?. llm(')).toBe(true)
    })

    it('detects bracket notation with double quotes', () => {
      expect(hasLLMCalls('it["llm"](')).toBe(true)
      expect(hasLLMCalls('it[ "llm" ](')).toBe(true)
    })

    it('detects bracket notation with single quotes', () => {
      expect(hasLLMCalls("it['llm'](")).toBe(true)
      expect(hasLLMCalls("it[ 'llm' ](")).toBe(true)
    })

    it('returns false for non-LLM patterns', () => {
      expect(hasLLMCalls('it.pullRequests')).toBe(false)
      expect(hasLLMCalls('submit.llm(')).toBe(false)
      expect(hasLLMCalls('myit.llm(')).toBe(false)
      expect(hasLLMCalls('it.llm')).toBe(false) // no opening paren
      expect(hasLLMCalls('it.lLm(')).toBe(false) // wrong case
    })

    it('returns false for empty string', () => {
      expect(hasLLMCalls('')).toBe(false)
    })

    it('detects LLM call in real template', () => {
      const template = `Release <%= it.date %>

### Summary
<%~ await it.llm('Summarize this release') %>`
      expect(hasLLMCalls(template)).toBe(true)
    })

    it('returns false for template without LLM', () => {
      const template = `Release <%= it.date %>

### PRs
<% it.pullRequests.forEach(pr => { %>
- #<%= pr.number %> <%= pr.title %>
<% }) %>`
      expect(hasLLMCalls(template)).toBe(false)
    })
  })
})
