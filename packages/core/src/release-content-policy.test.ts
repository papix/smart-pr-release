import { describe, expect, it } from 'vitest'
import { MAX_RELEASE_BODY_CHARS, MAX_RELEASE_TITLE_CHARS, validateReleaseContent } from './release-content-policy.js'

describe('validateReleaseContent', () => {
  it('accepts boundary-sized content and an empty body without changing it', () => {
    const title = ` ${'t'.repeat(MAX_RELEASE_TITLE_CHARS - 1)}`
    const body = 'b'.repeat(MAX_RELEASE_BODY_CHARS)
    expect(() => validateReleaseContent(title, body)).not.toThrow()
    expect(() => validateReleaseContent('Release', '')).not.toThrow()
  })

  it.each([
    ['RELEASE_TITLE_EMPTY', ' \t ', ''],
    ['RELEASE_TITLE_TOO_LONG', 't'.repeat(MAX_RELEASE_TITLE_CHARS + 1), ''],
    ['RELEASE_TITLE_INVALID_CHAR', 'bad\nrelease', ''],
    ['RELEASE_TITLE_INVALID_CHAR', 'bad\u007frelease', ''],
    ['RELEASE_BODY_TOO_LONG', 'Release', 'b'.repeat(MAX_RELEASE_BODY_CHARS + 1)],
    ['RELEASE_BODY_INVALID_CHAR', 'Release', 'bad\u0000body'],
    ['RELEASE_BODY_INVALID_CHAR', 'Release', 'bad\u007fbody'],
  ])('rejects invalid content with %s', (code, title, body) => {
    expect(() => validateReleaseContent(title, body)).toThrow(code)
  })

  it('allows TAB, LF, and CR in the body', () => {
    expect(() => validateReleaseContent('Release', 'a\tb\nc\rd')).not.toThrow()
  })
})
