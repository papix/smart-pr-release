import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock functions must be declared before vi.mock
const mockPullsGet = vi.fn()
const mockPullsUpdate = vi.fn()
const mockPullsList = vi.fn()
const mockPullsListFiles = vi.fn()
const mockPullsListCommits = vi.fn()
const mockPullsCreate = vi.fn()
const mockIssuesCreateLabel = vi.fn()
const mockIssuesAddLabels = vi.fn()
const mockReposGetCommit = vi.fn()
const mockReposCompareCommits = vi.fn()
const mockPaginate = vi.fn()

vi.mock('@octokit/rest', () => {
  // Create mock Octokit class inside the factory
  return {
    Octokit: class MockOctokit {
      rest = {
        pulls: {
          get: mockPullsGet,
          update: mockPullsUpdate,
          list: mockPullsList,
          listFiles: mockPullsListFiles,
          listCommits: mockPullsListCommits,
          create: mockPullsCreate,
        },
        issues: {
          createLabel: mockIssuesCreateLabel,
          addLabels: mockIssuesAddLabels,
        },
        repos: {
          getCommit: mockReposGetCommit,
          compareCommits: mockReposCompareCommits,
        },
      }
      paginate = mockPaginate
    },
  }
})

// Import after mock is set up
import { createGitHubClientFromEnv, GitHubClient } from './github-api.js'

describe('github-api', () => {
  describe('GitHubClient', () => {
    let client: GitHubClient

    beforeEach(() => {
      client = new GitHubClient({
        token: 'test-token',
        owner: 'test-owner',
        repo: 'test-repo',
      })
      vi.clearAllMocks()
      mockReposGetCommit.mockImplementation(({ ref }: { ref: string }) =>
        Promise.resolve({ data: { sha: `resolved-${ref}` } }),
      )
    })

    afterEach(() => {
      vi.restoreAllMocks()
    })

    describe('constructor', () => {
      it('accepts custom apiBase', () => {
        const customClient = new GitHubClient({
          token: 'test-token',
          owner: 'test-owner',
          repo: 'test-repo',
          apiBase: 'https://github.example.com/api/v3',
        })
        expect(customClient).toBeInstanceOf(GitHubClient)
      })
    })

    describe('getPullRequest', () => {
      it('fetches pull request by number', async () => {
        const mockPR = {
          number: 123,
          title: 'Test PR',
          body: 'PR body',
          html_url: 'https://github.com/test/pr/123',
          base: { ref: 'main' },
          head: { ref: 'feature', sha: 'abc123' },
          labels: [{ name: 'bug' }],
          additions: 10,
          deletions: 5,
          changed_files: 2,
          updated_at: '2024-01-01T00:00:00Z',
          user: { login: 'testuser' },
        }
        mockPullsGet.mockResolvedValue({ data: mockPR })

        const result = await client.getPullRequest(123)

        expect(mockPullsGet).toHaveBeenCalledWith({
          owner: 'test-owner',
          repo: 'test-repo',
          pull_number: 123,
        })
        expect(result).toEqual({
          number: 123,
          title: 'Test PR',
          body: 'PR body',
          html_url: 'https://github.com/test/pr/123',
          base: { ref: 'main' },
          head: { ref: 'feature', sha: 'abc123' },
          labels: [{ name: 'bug' }],
          additions: 10,
          deletions: 5,
          changed_files: 2,
          updated_at: '2024-01-01T00:00:00Z',
          user: { login: 'testuser' },
        })
      })

      it('handles PR with null user', async () => {
        const mockPR = {
          number: 123,
          title: 'Test PR',
          body: null,
          html_url: 'https://github.com/test/pr/123',
          base: { ref: 'main' },
          head: { ref: 'feature', sha: 'abc123' },
          labels: [],
          additions: 0,
          deletions: 0,
          changed_files: 0,
          updated_at: '2024-01-01T00:00:00Z',
          user: null,
        }
        mockPullsGet.mockResolvedValue({ data: mockPR })

        const result = await client.getPullRequest(123)

        expect(result.user).toBeNull()
      })

      it('handles labels as strings and with null names', async () => {
        const mockPR = {
          number: 123,
          title: 'Test PR',
          body: null,
          html_url: 'https://github.com/test/pr/123',
          base: { ref: 'main' },
          head: { ref: 'feature', sha: 'abc123' },
          labels: ['string-label', { name: null }, { name: 'object-label' }],
          additions: 0,
          deletions: 0,
          changed_files: 0,
          updated_at: '2024-01-01T00:00:00Z',
          user: null,
        }
        mockPullsGet.mockResolvedValue({ data: mockPR })

        const result = await client.getPullRequest(123)

        expect(result.labels).toEqual([{ name: 'string-label' }, { name: '' }, { name: 'object-label' }])
      })

      it('throws error on 401 response', async () => {
        mockPullsGet.mockRejectedValue({ status: 401, message: 'Unauthorized' })

        await expect(client.getPullRequest(123)).rejects.toThrow('GitHub API authentication failed')
      })

      it('throws error on 403 response', async () => {
        mockPullsGet.mockRejectedValue({ status: 403, message: 'Forbidden' })

        await expect(client.getPullRequest(123)).rejects.toThrow('GitHub API authentication failed')
      })

      it('throws rate limit error on 403 with rate limit message', async () => {
        mockPullsGet.mockRejectedValue({ status: 403, message: 'API rate limit exceeded' })

        await expect(client.getPullRequest(123)).rejects.toThrow('GitHub API rate limit exceeded')
      })

      it('throws error on 500 response', async () => {
        mockPullsGet.mockRejectedValue({ status: 500, message: 'Internal Server Error' })

        await expect(client.getPullRequest(123)).rejects.toThrow('GitHub API server error')
      })

      it('throws error on other error responses', async () => {
        mockPullsGet.mockRejectedValue({ status: 404, message: 'Not Found' })

        await expect(client.getPullRequest(123)).rejects.toThrow('GitHub API error 404')
      })

      it('wraps unexpected Error throws with original message', async () => {
        mockPullsGet.mockRejectedValue(new Error('Network failure'))

        await expect(client.getPullRequest(123)).rejects.toThrow('Network failure')
      })

      it('handles timeout errors', async () => {
        const timeoutError = new Error('Request timeout')
        timeoutError.name = 'AbortError'
        mockPullsGet.mockRejectedValue(timeoutError)

        await expect(client.getPullRequest(123)).rejects.toThrow('GitHub API request timeout')
      })
    })

    describe('updatePullRequest', () => {
      it('updates pull request body', async () => {
        mockPullsUpdate.mockResolvedValue({ data: {} })

        await client.updatePullRequest(123, { body: 'New body' })

        expect(mockPullsUpdate).toHaveBeenCalledWith({
          owner: 'test-owner',
          repo: 'test-repo',
          pull_number: 123,
          body: 'New body',
        })
      })

      it('updates pull request title and body', async () => {
        mockPullsUpdate.mockResolvedValue({ data: {} })

        await client.updatePullRequest(123, { title: 'New title', body: 'New body' })

        expect(mockPullsUpdate).toHaveBeenCalledWith({
          owner: 'test-owner',
          repo: 'test-repo',
          pull_number: 123,
          title: 'New title',
          body: 'New body',
        })
      })

      it('throws error on failure', async () => {
        mockPullsUpdate.mockRejectedValue({ status: 500, message: 'Internal Server Error' })

        await expect(client.updatePullRequest(123, { body: 'New body' })).rejects.toThrow('GitHub API server error')
      })
    })

    describe('findOpenPullRequest', () => {
      it('finds open pull request by base and head', async () => {
        const mockPRs = [{ number: 123 }]
        mockPullsList.mockResolvedValue({ data: mockPRs })

        const result = await client.findOpenPullRequest('main', 'feature')

        expect(mockPullsList).toHaveBeenCalledWith({
          owner: 'test-owner',
          repo: 'test-repo',
          state: 'open',
          base: 'main',
          head: 'test-owner:feature',
          per_page: 1,
        })
        expect(result).toEqual([{ number: 123 }])
      })

      it('returns empty array when no PR found', async () => {
        mockPullsList.mockResolvedValue({ data: [] })

        const result = await client.findOpenPullRequest('main', 'feature')

        expect(result).toEqual([])
      })

      it('throws error on failure', async () => {
        mockPullsList.mockRejectedValue({ status: 500, message: 'Internal Server Error' })

        await expect(client.findOpenPullRequest('main', 'feature')).rejects.toThrow('GitHub API server error')
      })
    })

    describe('getPullRequestFiles', () => {
      it('fetches all files for a pull request', async () => {
        const mockFiles = [{ filename: 'file1.ts' }, { filename: 'file2.ts' }]
        mockPaginate.mockResolvedValue(mockFiles)

        const result = await client.getPullRequestFiles(123)

        expect(mockPaginate).toHaveBeenCalledWith(
          mockPullsListFiles,
          expect.objectContaining({
            owner: 'test-owner',
            repo: 'test-repo',
            pull_number: 123,
            per_page: 100,
          }),
        )
        expect(result).toEqual([{ filename: 'file1.ts' }, { filename: 'file2.ts' }])
      })

      it('throws error on failure', async () => {
        mockPaginate.mockRejectedValue({ status: 500, message: 'Internal Server Error' })

        await expect(client.getPullRequestFiles(123)).rejects.toThrow('GitHub API server error')
      })
    })

    describe('getPullRequestCommits', () => {
      it('fetches all commits for a pull request', async () => {
        const mockCommits = [
          { sha: 'abc123', commit: { message: 'Commit 1' } },
          { sha: 'def456', commit: { message: 'Commit 2' } },
        ]
        mockPaginate.mockResolvedValue(mockCommits)

        const result = await client.getPullRequestCommits(123)

        expect(mockPaginate).toHaveBeenCalledWith(
          mockPullsListCommits,
          expect.objectContaining({
            owner: 'test-owner',
            repo: 'test-repo',
            pull_number: 123,
            per_page: 100,
          }),
        )
        expect(result).toEqual([
          { sha: 'abc123', commit: { message: 'Commit 1' } },
          { sha: 'def456', commit: { message: 'Commit 2' } },
        ])
      })

      it('handles commits with null commit object', async () => {
        const mockCommits = [
          { sha: 'abc123', commit: null },
          { sha: 'def456', commit: { message: 'Commit 2' } },
        ]
        mockPaginate.mockResolvedValue(mockCommits)

        const result = await client.getPullRequestCommits(123)

        expect(result).toEqual([
          { sha: 'abc123', commit: undefined },
          { sha: 'def456', commit: { message: 'Commit 2' } },
        ])
      })

      it('throws error on failure', async () => {
        mockPaginate.mockRejectedValue({ status: 500, message: 'Internal Server Error' })

        await expect(client.getPullRequestCommits(123)).rejects.toThrow('GitHub API server error')
      })
    })

    describe('createLabel', () => {
      it('creates a label', async () => {
        mockIssuesCreateLabel.mockResolvedValue({ data: {} })

        await client.createLabel('test-label', 'ff0000', 'Test description')

        expect(mockIssuesCreateLabel).toHaveBeenCalledWith({
          owner: 'test-owner',
          repo: 'test-repo',
          name: 'test-label',
          color: 'ff0000',
          description: 'Test description',
        })
      })

      it('ignores 422 error (label already exists)', async () => {
        mockIssuesCreateLabel.mockRejectedValue({ status: 422, message: 'Validation Failed' })

        // Should not throw
        await expect(client.createLabel('existing-label', 'ff0000', 'Test')).resolves.toBeUndefined()
      })

      it('throws on non-422 errors', async () => {
        mockIssuesCreateLabel.mockRejectedValue({ status: 500, message: 'Internal Server Error' })

        await expect(client.createLabel('test-label', 'ff0000', 'Test')).rejects.toThrow()
      })
    })

    describe('addLabelsToIssue', () => {
      it('adds labels to an issue', async () => {
        mockIssuesAddLabels.mockResolvedValue({ data: {} })

        await client.addLabelsToIssue(123, ['label1', 'label2'])

        expect(mockIssuesAddLabels).toHaveBeenCalledWith({
          owner: 'test-owner',
          repo: 'test-repo',
          issue_number: 123,
          labels: ['label1', 'label2'],
        })
      })

      it('throws error on failure', async () => {
        mockIssuesAddLabels.mockRejectedValue({ status: 500, message: 'Internal Server Error' })

        await expect(client.addLabelsToIssue(123, ['label1'])).rejects.toThrow('GitHub API server error')
      })
    })

    describe('compareCommits', () => {
      it('pins mutable refs to commit SHAs before requesting comparison pages', async () => {
        mockReposCompareCommits.mockResolvedValue({
          data: {
            status: 'identical',
            ahead_by: 0,
            behind_by: 0,
            total_commits: 0,
            commits: [],
          },
        })

        await client.compareCommits('main', 'feature')

        expect(mockReposGetCommit).toHaveBeenCalledTimes(2)
        expect(mockReposGetCommit).toHaveBeenCalledWith({
          owner: 'test-owner',
          repo: 'test-repo',
          ref: 'main',
        })
        expect(mockReposGetCommit).toHaveBeenCalledWith({
          owner: 'test-owner',
          repo: 'test-repo',
          ref: 'feature',
        })
        expect(mockReposCompareCommits).toHaveBeenCalledWith(
          expect.objectContaining({ base: 'resolved-main', head: 'resolved-feature' }),
        )
      })

      it('compares commits between base and head', async () => {
        const mockComparison = {
          status: 'ahead',
          ahead_by: 1,
          behind_by: 0,
          total_commits: 1,
          commits: [
            {
              sha: 'abc123',
              commit: {
                message: 'Commit 1',
                author: { name: 'Test User', email: 'test@example.com', date: '2024-01-01T00:00:00Z' },
              },
            },
          ],
        }
        mockReposCompareCommits.mockResolvedValue({ data: mockComparison })

        const result = await client.compareCommits('main', 'feature')

        expect(mockReposCompareCommits).toHaveBeenCalledWith({
          owner: 'test-owner',
          repo: 'test-repo',
          base: 'resolved-main',
          head: 'resolved-feature',
          page: 1,
          per_page: 100,
        })
        expect(result).toEqual({
          status: 'ahead',
          ahead_by: 1,
          behind_by: 0,
          total_commits: 1,
          commits: [
            {
              sha: 'abc123',
              commit: {
                message: 'Commit 1',
                author: { name: 'Test User', email: 'test@example.com', date: '2024-01-01T00:00:00Z' },
              },
            },
          ],
        })
      })

      it('handles commits without author', async () => {
        const mockComparison = {
          status: 'ahead',
          ahead_by: 1,
          behind_by: 0,
          total_commits: 1,
          commits: [
            {
              sha: 'abc123',
              commit: {
                message: 'Commit 1',
                author: null,
              },
            },
          ],
        }
        mockReposCompareCommits.mockResolvedValue({ data: mockComparison })

        const result = await client.compareCommits('main', 'feature')

        expect(result.commits[0].commit.author).toBeUndefined()
      })

      it('handles commits with author having null properties', async () => {
        const mockComparison = {
          status: 'ahead',
          ahead_by: 1,
          behind_by: 0,
          total_commits: 1,
          commits: [
            {
              sha: 'abc123',
              commit: {
                message: 'Commit 1',
                author: { name: null, email: null, date: null },
              },
            },
          ],
        }
        mockReposCompareCommits.mockResolvedValue({ data: mockComparison })

        const result = await client.compareCommits('main', 'feature')

        expect(result.commits[0].commit.author).toEqual({
          name: undefined,
          email: undefined,
          date: undefined,
        })
      })

      it('fetches every page of a comparison', async () => {
        const commits = Array.from({ length: 250 }, (_, index) => ({
          sha: `sha-${index}`,
          commit: { message: `Commit ${index}`, author: null },
        }))
        mockReposCompareCommits
          .mockResolvedValueOnce({
            data: {
              status: 'ahead',
              ahead_by: 250,
              behind_by: 0,
              total_commits: 250,
              commits: commits.slice(0, 100),
            },
          })
          .mockResolvedValueOnce({
            data: {
              status: 'ahead',
              ahead_by: 250,
              behind_by: 0,
              total_commits: 250,
              commits: commits.slice(100, 200),
            },
          })
          .mockResolvedValueOnce({
            data: {
              status: 'ahead',
              ahead_by: 250,
              behind_by: 0,
              total_commits: 250,
              commits: commits.slice(200),
            },
          })

        const result = await client.compareCommits('main', 'feature')

        expect(mockReposCompareCommits).toHaveBeenCalledTimes(3)
        expect(mockReposCompareCommits).toHaveBeenNthCalledWith(3, {
          owner: 'test-owner',
          repo: 'test-repo',
          base: 'resolved-main',
          head: 'resolved-feature',
          page: 3,
          per_page: 100,
        })
        expect(result.commits).toHaveLength(250)
        expect(result.commits.at(-1)?.sha).toBe('sha-249')
      })

      it('fails closed when the API returns an incomplete comparison', async () => {
        mockReposCompareCommits.mockResolvedValue({
          data: {
            status: 'ahead',
            ahead_by: 2,
            behind_by: 0,
            total_commits: 2,
            commits: [
              {
                sha: 'abc123',
                commit: { message: 'Commit 1', author: null },
              },
            ],
          },
        })

        await expect(client.compareCommits('main', 'feature')).rejects.toThrow(
          'GitHub Compare API returned 1 of 2 commits',
        )
      })

      it('throws error on failure', async () => {
        mockReposCompareCommits.mockRejectedValue({ status: 404, message: 'Not Found' })

        await expect(client.compareCommits('main', 'feature')).rejects.toThrow('GitHub API error 404')
      })
    })

    describe('createPullRequest', () => {
      it('creates a new pull request', async () => {
        const mockPR = { number: 456, html_url: 'https://github.com/test/pr/456' }
        mockPullsCreate.mockResolvedValue({ data: mockPR })

        const result = await client.createPullRequest({
          title: 'Test PR',
          body: 'Test body',
          head: 'feature',
          base: 'main',
        })

        expect(mockPullsCreate).toHaveBeenCalledWith({
          owner: 'test-owner',
          repo: 'test-repo',
          title: 'Test PR',
          body: 'Test body',
          head: 'feature',
          base: 'main',
        })
        expect(result).toEqual(mockPR)
      })

      it('throws error on failure', async () => {
        mockPullsCreate.mockRejectedValue({ status: 422, message: 'Validation Failed' })

        await expect(
          client.createPullRequest({
            title: 'Test PR',
            body: 'Test body',
            head: 'feature',
            base: 'main',
          }),
        ).rejects.toThrow('GitHub API error 422')
      })
    })

    describe('error conversion edge cases', () => {
      it('handles non-Error non-object errors', async () => {
        mockPullsGet.mockRejectedValue('string error')

        await expect(client.getPullRequest(123)).rejects.toThrow('GitHub API request failed')
      })

      it('handles timeout message in error', async () => {
        mockPullsGet.mockRejectedValue(new Error('Connection timeout occurred'))

        await expect(client.getPullRequest(123)).rejects.toThrow('GitHub API request timeout')
      })
    })
  })

  describe('createGitHubClientFromEnv', () => {
    const originalEnv = process.env

    beforeEach(() => {
      process.env = { ...originalEnv }
    })

    afterEach(() => {
      process.env = originalEnv
    })

    it('creates client from environment variables', () => {
      process.env.GITHUB_TOKEN = 'env-token'
      process.env.GITHUB_REPOSITORY = 'owner/repo'

      const client = createGitHubClientFromEnv()

      expect(client).toBeInstanceOf(GitHubClient)
    })

    it('throws error if GITHUB_TOKEN is missing', () => {
      delete process.env.GITHUB_TOKEN
      process.env.GITHUB_REPOSITORY = 'owner/repo'

      expect(() => createGitHubClientFromEnv()).toThrow('Missing GITHUB_TOKEN environment variable')
    })

    it('throws error if GITHUB_REPOSITORY is missing', () => {
      process.env.GITHUB_TOKEN = 'test-token'
      delete process.env.GITHUB_REPOSITORY

      expect(() => createGitHubClientFromEnv()).toThrow('Missing GITHUB_REPOSITORY environment variable')
    })

    it('throws error if GITHUB_REPOSITORY is invalid format', () => {
      process.env.GITHUB_TOKEN = 'test-token'
      process.env.GITHUB_REPOSITORY = 'invalid-format'

      expect(() => createGitHubClientFromEnv()).toThrow('Invalid GITHUB_REPOSITORY')
    })
  })
})
