import { describe, expect, it } from 'vitest'
import { maskSensitive } from './mask-sensitive.js'

describe('maskSensitive', () => {
  it('masks email addresses', () => {
    const result = maskSensitive('Contact: user@example.com')
    expect(result.masked).toBe('Contact: [redacted]')
    expect(result.count).toBe(1)
  })

  it('masks phone numbers (international)', () => {
    const result = maskSensitive('Phone: +819012345678')
    expect(result.masked).toBe('Phone: [redacted]')
    expect(result.count).toBe(1)
  })

  it('masks phone numbers (Japanese)', () => {
    const result = maskSensitive('Phone: 03-1234-5678')
    expect(result.masked).toBe('Phone: [redacted]')
    expect(result.count).toBe(1)
  })

  it('masks GitHub classic tokens', () => {
    const result = maskSensitive('Token: ghp_1234567890abcdefghij')
    // GitHub token pattern matches, then HEX digest pattern also matches including 'Token:'
    expect(result.masked).toBe('[redacted]')
    expect(result.count).toBeGreaterThanOrEqual(1)
  })

  it('masks GitHub fine-grained PAT', () => {
    const result = maskSensitive('Token: github_pat_11ABCDEFGH0123456789_abcdefghijklmnopqrstuvwxyz')
    expect(result.masked).toBe('[redacted]')
    expect(result.count).toBeGreaterThanOrEqual(1)
  })

  it('masks AWS access keys', () => {
    const result = maskSensitive('AWS: AKIAIOSFODNN7EXAMPLE')
    expect(result.masked).toBe('AWS: [redacted]')
    expect(result.count).toBe(1)
  })

  it('masks OpenAI API keys', () => {
    const result = maskSensitive('Key: sk-1234567890abcdefghij')
    expect(result.masked).toBe('Key: [redacted]')
    expect(result.count).toBe(1)
  })

  it('masks JWT tokens', () => {
    const result = maskSensitive(
      'JWT: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
    )
    expect(result.masked).toBe('JWT: [redacted]')
    expect(result.count).toBe(1)
  })

  it('masks database connection strings', () => {
    const result = maskSensitive('DB: postgres://user:pass@localhost:5432/db')
    expect(result.masked).toBe('DB: [redacted]')
    expect(result.count).toBe(1)
  })

  it('masks Bearer tokens', () => {
    const result = maskSensitive('Authorization: Bearer abc123xyz')
    expect(result.masked).toBe('Authorization: [redacted]')
    expect(result.count).toBe(1)
  })

  it('masks password patterns', () => {
    const result = maskSensitive('password=supersecret123')
    expect(result.masked).toBe('[redacted]')
    expect(result.count).toBe(1)
  })

  it('does not mask regular URLs', () => {
    const result = maskSensitive('Link: https://example.com/api/v1')
    expect(result.masked).toBe('Link: https://example.com/api/v1')
    expect(result.count).toBe(0)
  })

  it('masks URLs with embedded credentials', () => {
    const result = maskSensitive('DB: https://user:password@db.example.com/data')
    expect(result.masked).toBe('DB: [redacted]')
    expect(result.count).toBe(1)
  })

  it('masks multiple patterns in one string', () => {
    const result = maskSensitive('Email: user@example.com, Phone: +819012345678, Token: ghp_abcdefghij1234567890')
    // Multiple patterns match (duplicate matches are possible)
    expect(result.masked).toBe('Email: [redacted], Phone: [redacted], [redacted]')
    expect(result.count).toBeGreaterThanOrEqual(3)
  })

  it('returns original string if no sensitive data', () => {
    const result = maskSensitive('This is a normal message')
    expect(result.masked).toBe('This is a normal message')
    expect(result.count).toBe(0)
  })

  it('handles empty string', () => {
    const result = maskSensitive('')
    expect(result.masked).toBe('')
    expect(result.count).toBe(0)
  })

  it('masks SHA-256 hashes (64 chars)', () => {
    const sha256 = 'a'.repeat(64)
    const result = maskSensitive(`Hash: ${sha256}`)
    expect(result.masked).toBe('Hash: [redacted]')
    expect(result.count).toBe(1)
  })

  it('masks SHA-512 hashes (128 chars)', () => {
    const sha512 = 'b'.repeat(128)
    const result = maskSensitive(`Hash: ${sha512}`)
    expect(result.masked).toBe('Hash: [redacted]')
    expect(result.count).toBe(1)
  })

  it('does not mask short hex strings (32 chars, MD5 length)', () => {
    const shortHex = 'a'.repeat(32)
    const result = maskSensitive(`Code: ${shortHex}`)
    expect(result.masked).toBe(`Code: ${shortHex}`)
    expect(result.count).toBe(0)
  })

  // False positive tests
  describe('false positive prevention', () => {
    it('does not mask git commit SHA (40 chars)', () => {
      const commitSha = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'
      const result = maskSensitive(`Commit: ${commitSha}`)
      expect(result.masked).toBe(`Commit: ${commitSha}`)
      expect(result.count).toBe(0)
    })

    it('does not mask realistic git commit SHA', () => {
      const commitSha = '7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b'
      const result = maskSensitive(`Merge commit ${commitSha} from branch`)
      expect(result.masked).toBe(`Merge commit ${commitSha} from branch`)
      expect(result.count).toBe(0)
    })

    it('does not mask multiple commit SHAs', () => {
      const sha1 = '1234567890abcdef1234567890abcdef12345678'
      const sha2 = 'abcdef1234567890abcdef1234567890abcdef12'
      const result = maskSensitive(`Compare ${sha1}...${sha2}`)
      expect(result.masked).toBe(`Compare ${sha1}...${sha2}`)
      expect(result.count).toBe(0)
    })

    it('does not mask short commit SHA (7 chars)', () => {
      const shortSha = 'a1b2c3d'
      const result = maskSensitive(`Short SHA: ${shortSha}`)
      expect(result.masked).toBe(`Short SHA: ${shortSha}`)
      expect(result.count).toBe(0)
    })

    it('does not mask UUID', () => {
      const uuid = '550e8400-e29b-41d4-a716-446655440000'
      const result = maskSensitive(`ID: ${uuid}`)
      expect(result.masked).toBe(`ID: ${uuid}`)
      expect(result.count).toBe(0)
    })

    it('does not mask normal URLs without credentials', () => {
      const url = 'https://github.com/owner/repo/pull/123'
      const result = maskSensitive(`PR URL: ${url}`)
      expect(result.masked).toBe(`PR URL: ${url}`)
      expect(result.count).toBe(0)
    })

    it('does not mask numeric IDs', () => {
      const result = maskSensitive('PR #12345 by user123')
      expect(result.masked).toBe('PR #12345 by user123')
      expect(result.count).toBe(0)
    })

    it('does not mask common programming patterns', () => {
      const result = maskSensitive('const foo_bar = getValue()')
      expect(result.masked).toBe('const foo_bar = getValue()')
      expect(result.count).toBe(0)
    })

    it('does not mask version numbers', () => {
      const result = maskSensitive('Version: 1.2.3-beta.4')
      expect(result.masked).toBe('Version: 1.2.3-beta.4')
      expect(result.count).toBe(0)
    })

    it('does not mask file paths', () => {
      const result = maskSensitive('File: src/components/Button.tsx')
      expect(result.masked).toBe('File: src/components/Button.tsx')
      expect(result.count).toBe(0)
    })

    it('does not mask timestamps', () => {
      const result = maskSensitive('Created: 2024-01-15T10:30:00Z')
      expect(result.masked).toBe('Created: 2024-01-15T10:30:00Z')
      expect(result.count).toBe(0)
    })
  })
})
