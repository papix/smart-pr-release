import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RunContext, RunDeps } from '#core/cli-types.js'
import { createReleasePR, run } from './index.js'

// Mock @actions/core
vi.mock('@actions/core', () => ({
  info: vi.fn(),
  warning: vi.fn(),
  setOutput: vi.fn(),
  setFailed: vi.fn(),
}))

// Mock #core/github-api.js with hoisted mock
const { mockCreateGitHubClientFromEnv } = vi.hoisted(() => ({
  mockCreateGitHubClientFromEnv: vi.fn(),
}))

vi.mock(import('#core/github-api.js'), () => ({
  createGitHubClientFromEnv: mockCreateGitHubClientFromEnv,
}))

describe('smart-pr-release-create', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('createReleasePR', () => {
    it('creates new PR when no existing PR number provided', async () => {
      const mockClient = {
        createPullRequest: vi.fn().mockResolvedValue({
          number: 100,
          html_url: 'https://github.com/test/pr/100',
        }),
      }

      const result = await createReleasePR({
        baseBranch: 'production',
        headBranch: 'main',
        title: 'Release 2024-01-15',
        body: '## Release Notes\n\n- Feature 1\n- Feature 2',
        client: mockClient as never,
      })

      expect(result.prNumber).toBe(100)
      expect(result.prUrl).toBe('https://github.com/test/pr/100')
      expect(result.created).toBe(true)
      expect(mockClient.createPullRequest).toHaveBeenCalledWith({
        title: 'Release 2024-01-15',
        body: '## Release Notes\n\n- Feature 1\n- Feature 2',
        head: 'main',
        base: 'production',
      })
    })

    it('updates existing PR when existing PR number provided', async () => {
      const mockClient = {
        updatePullRequest: vi.fn().mockResolvedValue({}),
        getPullRequest: vi.fn().mockResolvedValue({
          number: 123,
          html_url: 'https://github.com/test/pr/123',
        }),
      }

      const result = await createReleasePR({
        baseBranch: 'production',
        headBranch: 'main',
        title: 'Updated Release',
        body: 'Updated body',
        existingPrNumber: 123,
        client: mockClient as never,
      })

      expect(result.prNumber).toBe(123)
      expect(result.prUrl).toBe('https://github.com/test/pr/123')
      expect(result.created).toBe(false)
      expect(mockClient.updatePullRequest).toHaveBeenCalledWith(123, {
        title: 'Updated Release',
        body: 'Updated body',
      })
    })

    it('uses default branches', async () => {
      const mockClient = {
        createPullRequest: vi.fn().mockResolvedValue({
          number: 100,
          html_url: 'https://github.com/test/pr/100',
        }),
      }

      await createReleasePR({
        baseBranch: 'production',
        headBranch: 'main',
        title: 'Release',
        body: 'Body',
        client: mockClient as never,
      })

      expect(mockClient.createPullRequest).toHaveBeenCalledWith({
        title: 'Release',
        body: 'Body',
        head: 'main',
        base: 'production',
      })
    })

    it('creates PR with empty body', async () => {
      const mockClient = {
        createPullRequest: vi.fn().mockResolvedValue({
          number: 100,
          html_url: 'https://github.com/test/pr/100',
        }),
      }

      const result = await createReleasePR({
        baseBranch: 'production',
        headBranch: 'main',
        title: 'Release',
        body: '',
        client: mockClient as never,
      })

      expect(result.created).toBe(true)
      expect(mockClient.createPullRequest).toHaveBeenCalledWith({
        title: 'Release',
        body: '',
        head: 'main',
        base: 'production',
      })
    })

    describe('labels', () => {
      it('adds labels to new PR when labels provided', async () => {
        const mockClient = {
          createPullRequest: vi.fn().mockResolvedValue({
            number: 100,
            html_url: 'https://github.com/test/pr/100',
          }),
          addLabelsToIssue: vi.fn().mockResolvedValue({}),
        }

        const result = await createReleasePR({
          baseBranch: 'production',
          headBranch: 'main',
          title: 'Release',
          body: 'Body',
          labels: ['release', 'automated'],
          client: mockClient as never,
        })

        expect(result.created).toBe(true)
        expect(mockClient.addLabelsToIssue).toHaveBeenCalledWith(100, ['release', 'automated'])
      })

      it('adds labels to existing PR when labels provided', async () => {
        const mockClient = {
          updatePullRequest: vi.fn().mockResolvedValue({}),
          getPullRequest: vi.fn().mockResolvedValue({
            number: 123,
            html_url: 'https://github.com/test/pr/123',
          }),
          addLabelsToIssue: vi.fn().mockResolvedValue({}),
        }

        const result = await createReleasePR({
          baseBranch: 'production',
          headBranch: 'main',
          title: 'Release',
          body: 'Body',
          labels: ['release'],
          existingPrNumber: 123,
          client: mockClient as never,
        })

        expect(result.created).toBe(false)
        expect(mockClient.addLabelsToIssue).toHaveBeenCalledWith(123, ['release'])
      })

      it('does not call addLabelsToIssue when labels array is empty', async () => {
        const mockClient = {
          createPullRequest: vi.fn().mockResolvedValue({
            number: 100,
            html_url: 'https://github.com/test/pr/100',
          }),
          addLabelsToIssue: vi.fn().mockResolvedValue({}),
        }

        await createReleasePR({
          baseBranch: 'production',
          headBranch: 'main',
          title: 'Release',
          body: 'Body',
          labels: [],
          client: mockClient as never,
        })

        expect(mockClient.addLabelsToIssue).not.toHaveBeenCalled()
      })

      it('does not call addLabelsToIssue when labels not provided', async () => {
        const mockClient = {
          createPullRequest: vi.fn().mockResolvedValue({
            number: 100,
            html_url: 'https://github.com/test/pr/100',
          }),
          addLabelsToIssue: vi.fn().mockResolvedValue({}),
        }

        await createReleasePR({
          baseBranch: 'production',
          headBranch: 'main',
          title: 'Release',
          body: 'Body',
          client: mockClient as never,
        })

        expect(mockClient.addLabelsToIssue).not.toHaveBeenCalled()
      })
    })
  })

  describe('run', () => {
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
      },
      fs: {
        readFile: vi.fn(),
        writeFile: vi.fn(),
        mkdir: vi.fn(),
      },
      ...overrides,
    })

    it('creates PR with provided title and body', async () => {
      mockCreateGitHubClientFromEnv.mockReturnValue({
        createPullRequest: vi.fn().mockResolvedValue({
          number: 100,
          html_url: 'https://github.com/test/pr/100',
        }),
      } as never)

      const mockContext = createMockContext({
        env: {
          RELEASE_BASE: 'production',
          RELEASE_HEAD: 'main',
          RELEASE_TITLE: 'Release 2024-01-15',
          RELEASE_BODY: '## Notes\n- Item 1',
        },
      })
      const mockDeps = createMockDeps()

      await run(mockContext, mockDeps)

      expect(mockDeps.core.setOutput).toHaveBeenCalledWith('pr_number', '100')
      expect(mockDeps.core.setOutput).toHaveBeenCalledWith('pr_url', 'https://github.com/test/pr/100')
      expect(mockDeps.core.setOutput).toHaveBeenCalledWith('created', 'true')
    })

    it('updates existing PR when existing_pr_number provided', async () => {
      mockCreateGitHubClientFromEnv.mockReturnValue({
        updatePullRequest: vi.fn().mockResolvedValue({}),
        getPullRequest: vi.fn().mockResolvedValue({
          number: 123,
          html_url: 'https://github.com/test/pr/123',
        }),
      } as never)

      const mockContext = createMockContext({
        env: {
          RELEASE_BASE: 'production',
          RELEASE_HEAD: 'main',
          RELEASE_TITLE: 'Updated Release',
          RELEASE_BODY: 'Updated body',
          RELEASE_EXISTING_PR_NUMBER: '123',
        },
      })
      const mockDeps = createMockDeps()

      await run(mockContext, mockDeps)

      expect(mockDeps.core.setOutput).toHaveBeenCalledWith('pr_number', '123')
      expect(mockDeps.core.setOutput).toHaveBeenCalledWith('created', 'false')
    })

    it('fails when RELEASE_TITLE is not specified', async () => {
      const mockContext = createMockContext({
        env: {
          RELEASE_BODY: 'Body',
        },
      })
      const mockDeps = createMockDeps()

      await run(mockContext, mockDeps)

      expect(mockDeps.core.setFailed).toHaveBeenCalledWith('RELEASE_TITLE environment variable is required.')
    })

    it('fails when RELEASE_BODY is not specified', async () => {
      const mockContext = createMockContext({
        env: {
          RELEASE_TITLE: 'Title',
        },
      })
      const mockDeps = createMockDeps()

      await run(mockContext, mockDeps)

      expect(mockDeps.core.setFailed).toHaveBeenCalledWith('RELEASE_BODY environment variable is required.')
    })

    it('allows empty body', async () => {
      mockCreateGitHubClientFromEnv.mockReturnValue({
        createPullRequest: vi.fn().mockResolvedValue({
          number: 100,
          html_url: 'https://github.com/test/pr/100',
        }),
      } as never)

      const mockContext = createMockContext({
        env: {
          RELEASE_TITLE: 'Title',
          RELEASE_BODY: '',
        },
      })
      const mockDeps = createMockDeps()

      await run(mockContext, mockDeps)

      expect(mockDeps.core.setFailed).not.toHaveBeenCalled()
      expect(mockDeps.core.setOutput).toHaveBeenCalledWith('pr_number', '100')
    })

    it('calls setFailed on Error', async () => {
      mockCreateGitHubClientFromEnv.mockReturnValue({
        createPullRequest: vi.fn().mockRejectedValue(new Error('API Error')),
      } as never)

      const mockContext = createMockContext({
        env: {
          RELEASE_TITLE: 'Title',
          RELEASE_BODY: 'Body',
        },
      })
      const mockDeps = createMockDeps()

      await run(mockContext, mockDeps)

      expect(mockDeps.core.setFailed).toHaveBeenCalledWith('API Error')
    })

    it('calls setFailed with generic message on non-Error', async () => {
      mockCreateGitHubClientFromEnv.mockReturnValue({
        createPullRequest: vi.fn().mockRejectedValue('string error'),
      } as never)

      const mockContext = createMockContext({
        env: {
          RELEASE_TITLE: 'Title',
          RELEASE_BODY: 'Body',
        },
      })
      const mockDeps = createMockDeps()

      await run(mockContext, mockDeps)

      expect(mockDeps.core.setFailed).toHaveBeenCalledWith('An unexpected error occurred')
    })

    describe('labels', () => {
      it('adds labels from RELEASE_LABELS environment variable', async () => {
        const mockAddLabelsToIssue = vi.fn().mockResolvedValue({})
        mockCreateGitHubClientFromEnv.mockReturnValue({
          createPullRequest: vi.fn().mockResolvedValue({
            number: 100,
            html_url: 'https://github.com/test/pr/100',
          }),
          addLabelsToIssue: mockAddLabelsToIssue,
        } as never)

        const mockContext = createMockContext({
          env: {
            RELEASE_TITLE: 'Title',
            RELEASE_BODY: 'Body',
            RELEASE_LABELS: 'release,automated',
          },
        })
        const mockDeps = createMockDeps()

        await run(mockContext, mockDeps)

        expect(mockAddLabelsToIssue).toHaveBeenCalledWith(100, ['release', 'automated'])
      })

      it('handles labels with whitespace', async () => {
        const mockAddLabelsToIssue = vi.fn().mockResolvedValue({})
        mockCreateGitHubClientFromEnv.mockReturnValue({
          createPullRequest: vi.fn().mockResolvedValue({
            number: 100,
            html_url: 'https://github.com/test/pr/100',
          }),
          addLabelsToIssue: mockAddLabelsToIssue,
        } as never)

        const mockContext = createMockContext({
          env: {
            RELEASE_TITLE: 'Title',
            RELEASE_BODY: 'Body',
            RELEASE_LABELS: ' release , automated , important ',
          },
        })
        const mockDeps = createMockDeps()

        await run(mockContext, mockDeps)

        expect(mockAddLabelsToIssue).toHaveBeenCalledWith(100, ['release', 'automated', 'important'])
      })

      it('does not add labels when RELEASE_LABELS is empty', async () => {
        const mockAddLabelsToIssue = vi.fn().mockResolvedValue({})
        mockCreateGitHubClientFromEnv.mockReturnValue({
          createPullRequest: vi.fn().mockResolvedValue({
            number: 100,
            html_url: 'https://github.com/test/pr/100',
          }),
          addLabelsToIssue: mockAddLabelsToIssue,
        } as never)

        const mockContext = createMockContext({
          env: {
            RELEASE_TITLE: 'Title',
            RELEASE_BODY: 'Body',
            RELEASE_LABELS: '',
          },
        })
        const mockDeps = createMockDeps()

        await run(mockContext, mockDeps)

        expect(mockAddLabelsToIssue).not.toHaveBeenCalled()
      })

      it('does not add labels when RELEASE_LABELS is not set', async () => {
        const mockAddLabelsToIssue = vi.fn().mockResolvedValue({})
        mockCreateGitHubClientFromEnv.mockReturnValue({
          createPullRequest: vi.fn().mockResolvedValue({
            number: 100,
            html_url: 'https://github.com/test/pr/100',
          }),
          addLabelsToIssue: mockAddLabelsToIssue,
        } as never)

        const mockContext = createMockContext({
          env: {
            RELEASE_TITLE: 'Title',
            RELEASE_BODY: 'Body',
          },
        })
        const mockDeps = createMockDeps()

        await run(mockContext, mockDeps)

        expect(mockAddLabelsToIssue).not.toHaveBeenCalled()
      })

      it('filters out empty labels from comma-separated string', async () => {
        const mockAddLabelsToIssue = vi.fn().mockResolvedValue({})
        mockCreateGitHubClientFromEnv.mockReturnValue({
          createPullRequest: vi.fn().mockResolvedValue({
            number: 100,
            html_url: 'https://github.com/test/pr/100',
          }),
          addLabelsToIssue: mockAddLabelsToIssue,
        } as never)

        const mockContext = createMockContext({
          env: {
            RELEASE_TITLE: 'Title',
            RELEASE_BODY: 'Body',
            RELEASE_LABELS: 'release,,automated,',
          },
        })
        const mockDeps = createMockDeps()

        await run(mockContext, mockDeps)

        expect(mockAddLabelsToIssue).toHaveBeenCalledWith(100, ['release', 'automated'])
      })
    })
  })
})
