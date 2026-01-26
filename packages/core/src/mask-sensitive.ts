import type { MaskResult } from './types.js'

const MASK_TOKEN = '[redacted]'

const PATTERNS: RegExp[] = [
  // Email addresses
  /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,

  // Phone numbers (international format)
  /\+[1-9]\d{6,14}/g,
  // Phone numbers (Japanese format)
  /0\d{1,4}-\d{1,4}-\d{4}/g,

  // Credit card numbers
  /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|6(?:011|5[0-9]{2})[0-9]{12})\b/g,

  // GitHub tokens (classic: ghp_, gho_, ghu_, ghs_, ghr_)
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g,
  // GitHub tokens (fine-grained PAT)
  /\bgithub_pat_[A-Za-z0-9_]{22,}\b/g,

  // AWS Access Keys
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bASIA[0-9A-Z]{16}\b/g,

  // Google API Keys
  /\bAIza[0-9A-Za-z\-_]{35}\b/g,

  // OpenAI API Keys
  /\bsk-[A-Za-z0-9]{20,}\b/g,

  // Slack tokens
  /xox[baprs]-[0-9]{10,13}-[0-9]{10,13}[a-zA-Z0-9-]*/g,
  // Slack webhooks
  /https:\/\/hooks\.slack\.com\/services\/T[a-zA-Z0-9_]{8,10}\/B[a-zA-Z0-9_]{8,12}\/[a-zA-Z0-9_]{23,24}/g,

  // Discord webhooks
  /https:\/\/discord(?:app)?\.com\/api\/webhooks\/\d+\/[a-zA-Z0-9_-]+/g,

  // Stripe keys
  /sk_(?:live|test)_[0-9a-zA-Z]{24,}/g,
  /pk_(?:live|test)_[0-9a-zA-Z]{24,}/g,

  // SendGrid keys
  /SG\.[a-zA-Z0-9_-]{22}\.[a-zA-Z0-9_-]{43}/g,

  // Twilio keys
  /SK[a-f0-9]{32}/gi,

  // Firebase URLs
  /[a-z0-9-]+\.firebaseio\.com/gi,
  /[a-z0-9-]+\.firebaseapp\.com/gi,

  // Google OAuth tokens
  /ya29\.[0-9A-Za-z_-]+/g,

  // Database connection strings
  /(?:postgres|postgresql|mysql|mongodb|redis|amqp):\/\/[^\s'"]+/gi,

  // Generic auth URLs (username:password@host)
  /[a-zA-Z]{3,10}:\/\/[^/\s:@]{3,20}:[^/\s:@]{3,20}@[^\s'"]+/g,

  // Private keys
  /-----BEGIN (?:RSA |DSA |EC |PGP |OPENSSH )?PRIVATE KEY(?: BLOCK)?-----/g,

  // JWT tokens
  /eyJ[a-zA-Z0-9_-]*\.eyJ[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*/g,

  // Bearer tokens
  /Bearer\s+[a-zA-Z0-9_\-.]+/gi,

  // Basic auth headers
  /Basic\s+[a-zA-Z0-9+/=]+/gi,

  // Common secret patterns in config
  /(?:password|passwd|pwd|api[_-]?key|apikey|secret|token|auth)[\s]*[=:]\s*['"]?[^\s'"]{8,}['"]?/gi,

  // Hex digests (SHA-256: 64 chars, SHA-512: 128 chars)
  // MD5 (32 chars) excluded due to high false-positive rate
  /\b[0-9a-f]{64}\b/gi,
  /\b[0-9a-f]{128}\b/gi,
]

interface MatchRange {
  start: number
  end: number
}

// Merge overlapping ranges and return unique ranges
function mergeRanges(ranges: MatchRange[]): MatchRange[] {
  if (ranges.length === 0) return []

  // Sort by start position
  const sorted = [...ranges].sort((a, b) => a.start - b.start)
  const first = sorted[0]
  if (!first) return []

  const merged: MatchRange[] = [first]

  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i]
    const last = merged[merged.length - 1]

    if (!current || !last) continue

    if (current.start <= last.end) {
      // Overlapping or adjacent - merge
      last.end = Math.max(last.end, current.end)
    } else {
      merged.push(current)
    }
  }

  return merged
}

export function maskSensitive(input: string): MaskResult {
  const allMatches: MatchRange[] = []

  // Collect all matches from all patterns
  for (const pattern of PATTERNS) {
    pattern.lastIndex = 0
    for (;;) {
      const match = pattern.exec(input)
      if (!match) break
      allMatches.push({
        start: match.index,
        end: match.index + match[0].length,
      })
    }
  }

  // Merge overlapping ranges to get unique sensitive regions
  const uniqueRanges = mergeRanges(allMatches)
  const count = uniqueRanges.length

  // Replace from end to start to preserve indices
  let masked = input
  for (let i = uniqueRanges.length - 1; i >= 0; i--) {
    const range = uniqueRanges[i]
    if (!range) continue
    masked = masked.slice(0, range.start) + MASK_TOKEN + masked.slice(range.end)
  }

  return { masked, count }
}
