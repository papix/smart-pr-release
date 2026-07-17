# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.x     | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability in this project, please report it responsibly.

### How to Report

1. **Do NOT open a public issue** for security vulnerabilities
2. Send a private report via [GitHub Security Advisories](https://github.com/papix/smart-pr-release/security/advisories/new)
3. Alternatively, contact the maintainer directly

### What to Include

Please include the following information in your report:

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

### Response Timeline

- **Acknowledgment**: Within 48 hours
- **Initial Assessment**: Within 1 week
- **Resolution**: Depends on severity and complexity

### Security Measures in This Project

This project implements several security measures:

- **Sensitive Data Masking**: All text is automatically masked for sensitive patterns (API keys, passwords, tokens, PII) before being sent to AI providers
- **No Hardcoded Secrets**: All secrets are managed through environment variables or GitHub Secrets
- **Audit Logging**: AI API calls are logged and uploaded as workflow artifacts for review
- **LLM Output Sanitization**: Model-generated CommonMark is reduced to an allowlisted AST, links and reference-like text are neutralized, bidirectional controls are replaced, and the serialized output is re-parsed before use
- **Release Content Validation**: Rendered titles and bodies are rejected at the render and GitHub API boundaries when they exceed limits or contain prohibited control characters
- **Dependency Scanning**: Regular security updates for dependencies

LLM responses are limited to 16,384 UTF-16 code units before and after sanitization. Release titles are limited to 256 UTF-16 code units and bodies to 65,536. Validation is fail-closed: unsafe or oversized content is never truncated or normalized into acceptance. If an AI request starts, one aggregate audit write is attempted for the render whether processing succeeds or fails. Audit entries contain counts, duration, status, and stable error codes only; they exclude prompts, pull-request data, model output, URLs, mentions, secrets, and raw exceptions. An audit-write failure discards the render result.

Repository-specific custom autolinks and GitHub's implicit commit-SHA linking are residual risks because their definitions are unavailable to the render action. Maintainers should review generated release PRs and avoid custom autolink configurations that turn attacker-controlled plain text into unsafe destinations.

### Accepted Development-Only Advisory

`GHSA-g7r4-m6w7-qqqr` is temporarily accepted until **2026-08-16**. The lockfile resolves the affected package to `esbuild@0.27.7` through development-only paths rooted in `vitest`, `@vitest/coverage-v8`, `tsup`, and `vite-tsconfig-paths`. The Low-severity issue affects the esbuild development server on Windows; the patched range starts at `esbuild@0.28.1`.

Do not expose development servers to untrusted networks. Repository maintainers own this exception and must re-evaluate it by the review date or when the affected toolchain supports the patched esbuild release, whichever comes first.

## Best Practices for Users

When using smart-pr-release:

1. **Never commit `.env` files** - Use `.env.example` as a template
2. **Use GitHub Secrets** for sensitive values in workflows
3. **Rotate tokens regularly** - Especially after any potential exposure
4. **Review audit logs** - Check the AI audit artifacts in your workflow runs

## Security-Related Configuration

### Environment Variables

| Variable | Description | Security Note |
|----------|-------------|---------------|
| `GITHUB_TOKEN` | GitHub PAT | Use minimum required permissions |
| `OPENAI_API_KEY` | OpenAI API key | Rotate regularly |

### GitHub Actions Secrets

When using the reusable workflow, ensure secrets are properly configured:

```yaml
secrets:
  OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
```

The `GITHUB_TOKEN` is automatically provided by GitHub Actions with appropriate permissions.
