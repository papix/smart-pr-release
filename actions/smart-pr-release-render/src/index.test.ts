import * as fs from 'node:fs/promises'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RunContext, RunDeps } from '#core/cli-types.js'
import { renderReleasePR, run, validateBaseUrl } from './index.js'

// Mock OpenAI using vi.hoisted to ensure proper hoisting
const { mockCreate } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
}))

// Mock @actions/core
vi.mock('@actions/core', () => ({
  info: vi.fn(),
  warning: vi.fn(),
  notice: vi.fn(),
  setOutput: vi.fn(),
  setFailed: vi.fn(),
}))

// Mock fs
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
}))

// Mock OpenAI
vi.mock('openai', () => ({
  default: class OpenAI {
    chat = {
      completions: {
        create: mockCreate,
      },
    }
  },
}))

describe('smart-pr-release-render', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(fs.mkdir).mockResolvedValue(undefined)
    vi.mocked(fs.writeFile).mockResolvedValue(undefined)
    mockCreate.mockReset()
  })

  describe('renderReleasePR', () => {
    const baseMetadata = {
      generatedAt: '2024-01-15T10:00:00Z',
      baseBranch: 'production',
      headBranch: 'main',
      prs: [
        {
          number: 1,
          title: 'Add feature',
          author: 'user1',
          labels: ['enhancement'],
          url: 'https://github.com/test/pr/1',
          description: 'Description of feature',
          additions: 50,
          deletions: 10,
          changedFiles: 5,
        },
        {
          number: 2,
          title: 'Fix bug',
          author: 'user2',
          labels: ['bug'],
          url: 'https://github.com/test/pr/2',
          description: 'Bug fix',
          additions: 10,
          deletions: 5,
          changedFiles: 2,
        },
      ],
      stats: {
        totalAdditions: 60,
        totalDeletions: 15,
        totalChangedFiles: 7,
        extensionCounts: { ts: 5, tsx: 2 },
        commitMessages: ['commit 1', 'commit 2'],
        hasEnvFiles: false,
        hasCredentialFiles: false,
        hasSecretFiles: false,
        hasMigrationFiles: false,
      },
    }

    const simpleTemplate = `Release <%= it.date %>
## Pull Requests
<% for (const pr of it.pullRequests) { %>
- #<%= pr.number %> <%= pr.title %> by @<%= pr.author %>
<% } %>`

    it('renders template with PR data', async () => {
      vi.mocked(fs.readFile).mockResolvedValue(simpleTemplate)

      const result = await renderReleasePR({
        templatePath: '/tmp/template.md',
        metadata: baseMetadata,
        provider: 'none',
      })

      expect(result.title).toMatch(/Release \d{4}-\d{2}-\d{2} \d{2}:\d{2} JST/)
      expect(result.body).toContain('#1 Add feature')
      expect(result.body).toContain('#2 Fix bug')
      expect(result.body).toContain('@user1')
      expect(result.body).toContain('@user2')
    })

    it('renders template without LLM when provider is none', async () => {
      vi.mocked(fs.readFile).mockResolvedValue(simpleTemplate)

      const result = await renderReleasePR({
        templatePath: '/tmp/template.md',
        metadata: baseMetadata,
        provider: 'none',
      })

      expect(result.title).toBeDefined()
      expect(result.body).toBeDefined()
    })

    it('throws error when template requires LLM but not configured', async () => {
      const templateWithLLM = `Release
<%= await it.llm("Generate summary") %>`
      vi.mocked(fs.readFile).mockResolvedValue(templateWithLLM)

      await expect(
        renderReleasePR({
          templatePath: '/tmp/template.md',
          metadata: baseMetadata,
          provider: 'none',
        }),
      ).rejects.toThrow('Template contains LLM calls')
    })

    it('throws error when template not found', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'))

      await expect(
        renderReleasePR({
          templatePath: '/nonexistent/template.md',
          metadata: baseMetadata,
          provider: 'none',
        }),
      ).rejects.toThrow('Template file not found')
    })

    it('handles empty PR list', async () => {
      vi.mocked(fs.readFile).mockResolvedValue(simpleTemplate)

      const emptyMetadata = {
        ...baseMetadata,
        prs: [],
      }

      const result = await renderReleasePR({
        templatePath: '/tmp/template.md',
        metadata: emptyMetadata,
        provider: 'none',
      })

      expect(result.title).toBeDefined()
    })

    it('uses custom model when provided', async () => {
      vi.mocked(fs.readFile).mockResolvedValue(simpleTemplate)

      const result = await renderReleasePR({
        templatePath: '/tmp/template.md',
        metadata: baseMetadata,
        provider: 'none',
        model: 'gpt-5',
      })

      expect(result.title).toBeDefined()
    })

    it('masks sensitive information in PR data', async () => {
      vi.mocked(fs.readFile).mockResolvedValue(simpleTemplate)

      const metadataWithSensitive = {
        ...baseMetadata,
        prs: [
          {
            number: 1,
            title: 'Fix token leak API_KEY=secret123',
            author: 'user1',
            labels: [],
            url: 'https://github.com/test/pr/1',
            description: 'Description',
            additions: 10,
            deletions: 5,
            changedFiles: 2,
          },
        ],
      }

      const result = await renderReleasePR({
        templatePath: '/tmp/template.md',
        metadata: metadataWithSensitive,
        provider: 'none',
      })

      expect(result.body).not.toContain('secret123')
      // escapeMarkdown escapes brackets as \[redacted\]
      expect(result.body).toContain('\\[redacted\\]')
    })

    it('detects LLM calls with whitespace variations', async () => {
      const templateWithSpaces = `Release <%= it.date %>
<%= await it . llm ( "Generate summary" ) %>`
      vi.mocked(fs.readFile).mockResolvedValue(templateWithSpaces)

      await expect(
        renderReleasePR({
          templatePath: '/tmp/template.md',
          metadata: baseMetadata,
          provider: 'none',
        }),
      ).rejects.toThrow('Template contains LLM calls')
    })

    describe('with LLM provider', () => {
      const templateWithLLM = `Release <%= it.date %>

<%= await it.llm("Generate a summary of the changes") %>`

      it('calls OpenAI API and renders template with LLM response', async () => {
        vi.mocked(fs.readFile).mockResolvedValue(templateWithLLM)
        mockCreate.mockResolvedValue({
          choices: [{ message: { content: 'This release includes new features and bug fixes.' } }],
        })

        const result = await renderReleasePR({
          templatePath: '/tmp/template.md',
          metadata: baseMetadata,
          provider: 'openai',
          apiKey: 'test-api-key',
          model: 'gpt-4o-mini',
          baseUrl: 'https://api.openai.com',
          temperature: 0.5,
          outputLanguage: 'en',
        })

        expect(mockCreate).toHaveBeenCalledWith(
          expect.objectContaining({
            model: 'gpt-4o-mini',
            temperature: 0.5,
          }),
        )
        expect(result.body).toContain('This release includes new features and bug fixes.')
      })

      it('writes audit log after successful LLM call', async () => {
        vi.mocked(fs.readFile).mockResolvedValue(templateWithLLM)
        mockCreate.mockResolvedValue({
          choices: [{ message: { content: 'Summary content' } }],
        })

        await renderReleasePR({
          templatePath: '/tmp/template.md',
          metadata: baseMetadata,
          provider: 'openai',
          apiKey: 'test-api-key',
          auditPath: '/tmp/audit.json',
        })

        expect(fs.mkdir).toHaveBeenCalledWith('/tmp', { recursive: true, mode: 0o700 })
        expect(fs.writeFile).toHaveBeenCalledWith(
          '/tmp/audit.json',
          expect.stringContaining('"action": "external_ai_request"'),
          expect.objectContaining({ mode: 0o600 }),
        )
      })

      it('records accurate piiMaskedCount in audit log', async () => {
        vi.mocked(fs.readFile).mockResolvedValue(templateWithLLM)
        mockCreate.mockResolvedValue({
          choices: [{ message: { content: 'Summary content' } }],
        })

        const metadataWithSensitive = {
          ...baseMetadata,
          prs: [
            {
              number: 1,
              title: 'Fix leak API_KEY=secret123',
              author: 'user1',
              labels: [],
              url: 'https://github.com/test/pr/1',
              description: 'Description',
              additions: 10,
              deletions: 5,
              changedFiles: 2,
            },
          ],
        }

        await renderReleasePR({
          templatePath: '/tmp/template.md',
          metadata: metadataWithSensitive,
          provider: 'openai',
          apiKey: 'test-api-key',
          auditPath: '/tmp/audit.json',
        })

        const writeCall = vi.mocked(fs.writeFile).mock.calls[0]
        const auditContent = JSON.parse(writeCall[1] as string)
        expect(auditContent.piiMaskedCount).toBeGreaterThan(0)
      })

      it('throws error when OpenAI returns no content', async () => {
        vi.mocked(fs.readFile).mockResolvedValue(templateWithLLM)
        mockCreate.mockResolvedValue({
          choices: [{ message: { content: null } }],
        })

        await expect(
          renderReleasePR({
            templatePath: '/tmp/template.md',
            metadata: baseMetadata,
            provider: 'openai',
            apiKey: 'test-api-key',
          }),
        ).rejects.toThrow('OpenAI response missing content')
      })

      it('throws error when OpenAI returns empty choices', async () => {
        vi.mocked(fs.readFile).mockResolvedValue(templateWithLLM)
        mockCreate.mockResolvedValue({
          choices: [],
        })

        await expect(
          renderReleasePR({
            templatePath: '/tmp/template.md',
            metadata: baseMetadata,
            provider: 'openai',
            apiKey: 'test-api-key',
          }),
        ).rejects.toThrow('OpenAI response missing content')
      })

      it('builds correct PR context in LLM prompt', async () => {
        vi.mocked(fs.readFile).mockResolvedValue(templateWithLLM)
        mockCreate.mockResolvedValue({
          choices: [{ message: { content: 'Generated summary' } }],
        })

        await renderReleasePR({
          templatePath: '/tmp/template.md',
          metadata: baseMetadata,
          provider: 'openai',
          apiKey: 'test-api-key',
        })

        // Check that the prompt includes PR context in JSON format
        const callArgs = mockCreate.mock.calls[0][0]
        const userMessage = callArgs.messages.find((m: { role: string }) => m.role === 'user')
        expect(userMessage.content).toContain('"number": 1')
        expect(userMessage.content).toContain('"title": "Add feature"')
        expect(userMessage.content).toContain('"number": 2')
        expect(userMessage.content).toContain('"title": "Fix bug"')
        expect(userMessage.content).toContain('"author": "user1"')
        expect(userMessage.content).toContain('"author": "user2"')
      })

      it('handles empty PR list in LLM prompt', async () => {
        vi.mocked(fs.readFile).mockResolvedValue(templateWithLLM)
        mockCreate.mockResolvedValue({
          choices: [{ message: { content: 'No changes summary' } }],
        })

        const emptyMetadata = { ...baseMetadata, prs: [] }

        await renderReleasePR({
          templatePath: '/tmp/template.md',
          metadata: emptyMetadata,
          provider: 'openai',
          apiKey: 'test-api-key',
        })

        const callArgs = mockCreate.mock.calls[0][0]
        const userMessage = callArgs.messages.find((m: { role: string }) => m.role === 'user')
        expect(userMessage.content).toContain('No pull requests in this release.')
      })

      it('does not include temperature for gpt-5 models', async () => {
        vi.mocked(fs.readFile).mockResolvedValue(templateWithLLM)
        mockCreate.mockResolvedValue({
          choices: [{ message: { content: 'Summary' } }],
        })

        await renderReleasePR({
          templatePath: '/tmp/template.md',
          metadata: baseMetadata,
          provider: 'openai',
          apiKey: 'test-api-key',
          model: 'gpt-5',
          temperature: 0.5,
        })

        const callArgs = mockCreate.mock.calls[0][0]
        expect(callArgs.temperature).toBeUndefined()
      })

      it('includes temperature for non-gpt-5 models', async () => {
        vi.mocked(fs.readFile).mockResolvedValue(templateWithLLM)
        mockCreate.mockResolvedValue({
          choices: [{ message: { content: 'Summary' } }],
        })

        await renderReleasePR({
          templatePath: '/tmp/template.md',
          metadata: baseMetadata,
          provider: 'openai',
          apiKey: 'test-api-key',
          model: 'gpt-4o',
          temperature: 0.7,
        })

        const callArgs = mockCreate.mock.calls[0][0]
        expect(callArgs.temperature).toBe(0.7)
      })

      it('normalizes destination URL in audit log', async () => {
        vi.mocked(fs.readFile).mockResolvedValue(templateWithLLM)
        mockCreate.mockResolvedValue({
          choices: [{ message: { content: 'Summary' } }],
        })

        await renderReleasePR({
          templatePath: '/tmp/template.md',
          metadata: baseMetadata,
          provider: 'openai',
          apiKey: 'test-api-key',
          baseUrl: 'https://custom.openai.com/path',
          auditPath: '/tmp/audit.json',
        })

        const writeCall = vi.mocked(fs.writeFile).mock.calls[0]
        const auditContent = writeCall[1] as string
        expect(auditContent).toContain('"destination": "custom.openai.com"')
      })

      it('uses original string when baseUrl is not a valid URL', async () => {
        vi.mocked(fs.readFile).mockResolvedValue(templateWithLLM)
        mockCreate.mockResolvedValue({
          choices: [{ message: { content: 'Summary' } }],
        })

        await renderReleasePR({
          templatePath: '/tmp/template.md',
          metadata: baseMetadata,
          provider: 'openai',
          apiKey: 'test-api-key',
          baseUrl: 'not-a-valid-url',
          auditPath: '/tmp/audit.json',
        })

        const writeCall = vi.mocked(fs.writeFile).mock.calls[0]
        const auditContent = writeCall[1] as string
        expect(auditContent).toContain('"destination": "not-a-valid-url"')
      })

      it('does not write audit log when provider is configured but no LLM calls in template', async () => {
        const templateWithoutLLM = `Release <%= it.date %>
<% for (const pr of it.pullRequests) { %>
- #<%= pr.number %> <%= pr.title %>
<% } %>`
        vi.mocked(fs.readFile).mockResolvedValue(templateWithoutLLM)

        await renderReleasePR({
          templatePath: '/tmp/template.md',
          metadata: baseMetadata,
          provider: 'openai',
          apiKey: 'test-api-key',
          auditPath: '/tmp/audit.json',
        })

        // No LLM calls were made, so no audit log should be written
        expect(mockCreate).not.toHaveBeenCalled()
        expect(fs.writeFile).not.toHaveBeenCalled()
      })

      it('records actual prompt length including PR context and system message in audit log', async () => {
        vi.mocked(fs.readFile).mockResolvedValue(templateWithLLM)
        mockCreate.mockResolvedValue({
          choices: [{ message: { content: 'Summary content' } }],
        })

        await renderReleasePR({
          templatePath: '/tmp/template.md',
          metadata: baseMetadata,
          provider: 'openai',
          apiKey: 'test-api-key',
          auditPath: '/tmp/audit.json',
        })

        const writeCall = vi.mocked(fs.writeFile).mock.calls[0]
        const auditContent = JSON.parse(writeCall[1] as string)

        // Get the actual messages sent to OpenAI
        const callArgs = mockCreate.mock.calls[0][0]
        const systemMessage = callArgs.messages.find((m: { role: string }) => m.role === 'system')
        const userMessage = callArgs.messages.find((m: { role: string }) => m.role === 'user')

        // inputCharCount should include both user prompt and system message
        const expectedLength = systemMessage.content.length + userMessage.content.length
        expect(auditContent.inputCharCount).toBe(expectedLength)

        // Token estimate should be based on actual prompt length
        expect(auditContent.inputTokenEstimate).toBe(Math.ceil(auditContent.inputCharCount / 4))
      })
    })
  })

  describe('validateBaseUrl', () => {
    it('allows empty URL', () => {
      expect(() => validateBaseUrl('')).not.toThrow()
    })

    it('allows HTTPS URLs', () => {
      expect(() => validateBaseUrl('https://api.example.com')).not.toThrow()
    })

    it('throws for HTTP URLs', () => {
      expect(() => validateBaseUrl('http://api.example.com')).toThrow('AI_BASE_URL must use HTTPS protocol')
    })

    it('throws for FTP URLs', () => {
      expect(() => validateBaseUrl('ftp://files.example.com')).toThrow('AI_BASE_URL must use HTTPS protocol')
    })
  })

  describe('run', () => {
    const simpleTemplate = `Release <%= it.date %>
## PRs
<% for (const pr of it.pullRequests) { %>
- #<%= pr.number %>
<% } %>`

    const baseMetadataJson = JSON.stringify({
      generatedAt: '2024-01-15T10:00:00Z',
      baseBranch: 'production',
      headBranch: 'main',
      prs: [
        {
          number: 1,
          title: 'Add feature',
          author: 'user1',
          labels: ['enhancement'],
          url: 'https://github.com/test/pr/1',
          description: 'Feature description',
          additions: 50,
          deletions: 10,
          changedFiles: 5,
        },
      ],
      stats: {
        totalAdditions: 50,
        totalDeletions: 10,
        totalChangedFiles: 5,
        extensionCounts: { ts: 3 },
        commitMessages: ['Initial commit'],
        hasEnvFiles: false,
        hasCredentialFiles: false,
        hasSecretFiles: false,
        hasMigrationFiles: false,
      },
    })

    const createMockContext = (overrides: Partial<RunContext> = {}): RunContext => ({
      env: {},
      argv: [],
      cwd: () => '/test',
      ...overrides,
    })

    const createMockDeps = (overrides: Partial<RunDeps> = {}): RunDeps => ({
      core: {
        info: vi.fn(),
        warning: vi.fn(),
        setOutput: vi.fn(),
        setFailed: vi.fn(),
        notice: vi.fn(),
      },
      fs: {
        readFile: vi.fn().mockResolvedValue(baseMetadataJson),
        writeFile: vi.fn(),
        mkdir: vi.fn(),
      },
      ...overrides,
    })

    beforeEach(() => {
      vi.mocked(fs.readFile).mockResolvedValue(simpleTemplate)
    })

    it('renders template and outputs title/body', async () => {
      const mockContext = createMockContext({
        env: {
          RELEASE_TEMPLATE_PATH: '/tmp/template.md',
          RELEASE_METADATA_PATH: '/tmp/metadata.json',
        },
      })
      const mockDeps = createMockDeps()

      await run(mockContext, mockDeps)

      expect(mockDeps.core.setOutput).toHaveBeenCalledWith('title', expect.stringContaining('Release'))
      expect(mockDeps.core.setOutput).toHaveBeenCalledWith('body', expect.stringContaining('#1'))
    })

    it('uses default paths when not specified', async () => {
      const mockContext = createMockContext()
      const mockDeps = createMockDeps()

      await run(mockContext, mockDeps)

      expect(mockDeps.core.info).toHaveBeenCalledWith('Template path: .github/release-template.md')
      expect(mockDeps.core.info).toHaveBeenCalledWith('Metadata path: .smart-pr-release/metadata.json')
    })

    it('throws error when AI_TEMPERATURE is not a number', async () => {
      const mockContext = createMockContext({
        env: {
          AI_TEMPERATURE: 'invalid',
        },
      })
      const mockDeps = createMockDeps()

      await run(mockContext, mockDeps)

      expect(mockDeps.core.setFailed).toHaveBeenCalledWith('AI_TEMPERATURE must be a number')
    })

    it('throws error when AI_TEMPERATURE is out of range', async () => {
      const mockContext = createMockContext({
        env: {
          AI_TEMPERATURE: '3',
        },
      })
      const mockDeps = createMockDeps()

      await run(mockContext, mockDeps)

      expect(mockDeps.core.setFailed).toHaveBeenCalledWith('AI_TEMPERATURE must be between 0 and 2')
    })

    it('throws error when AI_BASE_URL is not HTTPS', async () => {
      const mockContext = createMockContext({
        env: {
          AI_BASE_URL: 'http://api.example.com',
        },
      })
      const mockDeps = createMockDeps()

      await run(mockContext, mockDeps)

      expect(mockDeps.core.setFailed).toHaveBeenCalledWith('AI_BASE_URL must use HTTPS protocol')
    })

    it('uses default temperature when not specified', async () => {
      const mockContext = createMockContext({
        env: {
          AI_TEMPERATURE: '',
        },
      })
      const mockDeps = createMockDeps()

      await run(mockContext, mockDeps)

      // Should not throw - uses default of 0.2
      expect(mockDeps.core.setFailed).not.toHaveBeenCalled()
    })

    it('calls setFailed with generic message on non-Error', async () => {
      const mockContext = createMockContext()
      const mockDeps = createMockDeps({
        core: {
          info: vi.fn(),
          warning: vi.fn(),
          setOutput: vi.fn(),
          setFailed: vi.fn(),
        },
        fs: {
          readFile: vi.fn().mockRejectedValue('string error'),
          writeFile: vi.fn(),
          mkdir: vi.fn(),
        },
      })

      await run(mockContext, mockDeps)

      expect(mockDeps.core.setFailed).toHaveBeenCalledWith('An unexpected error occurred')
    })

    it('logs AI provider when configured', async () => {
      const mockContext = createMockContext({
        env: {
          AI_PROVIDER: 'openai',
          AI_API_KEY: 'test-key',
        },
      })
      const mockDeps = createMockDeps()

      await run(mockContext, mockDeps)

      expect(mockDeps.core.info).toHaveBeenCalledWith('Using AI provider: openai')
    })

    it('resolves paths relative to GITHUB_WORKSPACE when set', async () => {
      const mockContext = createMockContext({
        env: {
          GITHUB_WORKSPACE: '/workspace/caller-repo',
          RELEASE_TEMPLATE_PATH: '.github/release-template.md',
          RELEASE_METADATA_PATH: '.smart-pr-release/metadata.json',
        },
      })
      const mockDeps = createMockDeps()

      await run(mockContext, mockDeps)

      // Verify paths are resolved relative to GITHUB_WORKSPACE
      expect(mockDeps.core.info).toHaveBeenCalledWith(
        'Template path: /workspace/caller-repo/.github/release-template.md',
      )
      expect(mockDeps.core.info).toHaveBeenCalledWith(
        'Metadata path: /workspace/caller-repo/.smart-pr-release/metadata.json',
      )

      // Verify fs.readFile was called with the resolved metadata path
      expect(mockDeps.fs.readFile).toHaveBeenCalledWith(
        '/workspace/caller-repo/.smart-pr-release/metadata.json',
        'utf8',
      )
    })

    it('uses relative paths when GITHUB_WORKSPACE is not set', async () => {
      const mockContext = createMockContext({
        env: {
          // GITHUB_WORKSPACE is not set
          RELEASE_TEMPLATE_PATH: '.github/release-template.md',
          RELEASE_METADATA_PATH: '.smart-pr-release/metadata.json',
        },
      })
      const mockDeps = createMockDeps()

      await run(mockContext, mockDeps)

      // Verify paths remain relative when GITHUB_WORKSPACE is not set
      expect(mockDeps.core.info).toHaveBeenCalledWith('Template path: .github/release-template.md')
      expect(mockDeps.core.info).toHaveBeenCalledWith('Metadata path: .smart-pr-release/metadata.json')

      // Verify fs.readFile was called with the relative metadata path
      expect(mockDeps.fs.readFile).toHaveBeenCalledWith('.smart-pr-release/metadata.json', 'utf8')
    })

    it('preserves absolute paths even when GITHUB_WORKSPACE is set', async () => {
      const mockContext = createMockContext({
        env: {
          GITHUB_WORKSPACE: '/workspace/caller-repo',
          RELEASE_TEMPLATE_PATH: '/absolute/path/template.md',
          RELEASE_METADATA_PATH: '/absolute/path/metadata.json',
        },
      })
      const mockDeps = createMockDeps()

      await run(mockContext, mockDeps)

      // Verify absolute paths are preserved (not prefixed with GITHUB_WORKSPACE)
      expect(mockDeps.core.info).toHaveBeenCalledWith('Template path: /absolute/path/template.md')
      expect(mockDeps.core.info).toHaveBeenCalledWith('Metadata path: /absolute/path/metadata.json')

      // Verify fs.readFile was called with the absolute metadata path
      expect(mockDeps.fs.readFile).toHaveBeenCalledWith('/absolute/path/metadata.json', 'utf8')
    })
  })
})
