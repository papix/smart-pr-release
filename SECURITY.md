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
- **Dependency Scanning**: Regular security updates for dependencies

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
