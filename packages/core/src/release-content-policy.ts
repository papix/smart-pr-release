export const MAX_RELEASE_TITLE_CHARS = 256
export const MAX_RELEASE_BODY_CHARS = 65_536

export type ReleaseContentErrorCode =
  | 'RELEASE_TITLE_EMPTY'
  | 'RELEASE_TITLE_TOO_LONG'
  | 'RELEASE_TITLE_INVALID_CHAR'
  | 'RELEASE_BODY_TOO_LONG'
  | 'RELEASE_BODY_INVALID_CHAR'

export class ReleaseContentPolicyError extends Error {
  readonly code: ReleaseContentErrorCode

  constructor(code: ReleaseContentErrorCode) {
    super(code)
    this.name = 'ReleaseContentPolicyError'
    this.code = code
  }
}

export function validateReleaseContent(title: string, body: string): void {
  if (title.trim().length === 0) throw new ReleaseContentPolicyError('RELEASE_TITLE_EMPTY')
  if (title.length > MAX_RELEASE_TITLE_CHARS) throw new ReleaseContentPolicyError('RELEASE_TITLE_TOO_LONG')
  // biome-ignore lint/suspicious/noControlCharactersInRegex: fail-closed release title validation
  if (/[\x00-\x1F\x7F]/.test(title)) throw new ReleaseContentPolicyError('RELEASE_TITLE_INVALID_CHAR')
  if (body.length > MAX_RELEASE_BODY_CHARS) throw new ReleaseContentPolicyError('RELEASE_BODY_TOO_LONG')
  // biome-ignore lint/suspicious/noControlCharactersInRegex: TAB/LF/CR are the only allowed body controls
  if (/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(body)) {
    throw new ReleaseContentPolicyError('RELEASE_BODY_INVALID_CHAR')
  }
}
