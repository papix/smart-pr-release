export type SmartPrReleaseErrorCode =
  | 'GITHUB_AUTH_FAILED'
  | 'GITHUB_RATE_LIMIT'
  | 'GITHUB_SERVER_ERROR'
  | 'GITHUB_REQUEST_TIMEOUT'
  | 'GITHUB_REQUEST_FAILED'
  | 'GITHUB_INVALID_RESPONSE'
  | 'TEMPLATE_NOT_FOUND'
  | 'TEMPLATE_RENDER_FAILED'
  | 'LLM_NOT_CONFIGURED'
  | 'LLM_RESPONSE_EMPTY'
  | 'CONFIG_INVALID'
  | 'MISSING_ENV_VAR'
  | 'INVALID_INPUT'

export class SmartPrReleaseError extends Error {
  readonly code: SmartPrReleaseErrorCode

  constructor(code: SmartPrReleaseErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'SmartPrReleaseError'
    this.code = code
  }
}

export class GitHubApiError extends SmartPrReleaseError {
  readonly statusCode?: number

  constructor(code: SmartPrReleaseErrorCode, message: string, statusCode?: number, options?: ErrorOptions) {
    super(code, message, options)
    this.name = 'GitHubApiError'
    this.statusCode = statusCode
  }
}
