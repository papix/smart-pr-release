# smart-pr-release

AI-powered release PR automation for GitHub. Automatically creates release PRs and generates AI summaries using OpenAI.

## Packages

This monorepo contains:

| Package | Description |
|---------|-------------|
| [@papix/smart-pr-release-core](./packages/core) | Core library |
| [@papix/smart-pr-release-cli](./packages/cli) | CLI tool |
| [GitHub Actions](./actions) | Reusable GitHub Actions |

## Features

- Automatic release PR creation from merge commits
- AI-powered release summary generation (OpenAI)
- Automatic masking of sensitive information before sending to AI
- Customizable Eta templates and prompts
- PR metadata caching to reduce GitHub API calls
- Reusable GitHub Actions workflow

## Quick Start

### Using CLI

```bash
# Show help
npx tsx packages/cli/src/index.ts --help

# Find and update release PR (default: dry-run mode)
npx tsx packages/cli/src/index.ts --repo owner/repo --template .github/release-template.md

# Preview with AI summary
npx tsx packages/cli/src/index.ts --repo owner/repo --template .github/release-template.md --provider openai

# Actually create/update the PR (requires --execute)
npx tsx packages/cli/src/index.ts --repo owner/repo --template .github/release-template.md --provider openai --execute
```

Environment variables:
- `GITHUB_TOKEN` - GitHub personal access token (required)
- `OPENAI_API_KEY` - OpenAI API key (required if `--provider openai`)

### Using Reusable Workflow (Recommended)

Create a workflow file in your repository:

```yaml
# .github/workflows/smart-pr-release.yml
name: Create Release PR

on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  smart-pr-release:
    uses: papix/smart-pr-release/.github/workflows/smart-pr-release.yml@v1
    secrets: inherit
```

### Configuration Options

```yaml
jobs:
  smart-pr-release:
    uses: papix/smart-pr-release/.github/workflows/smart-pr-release.yml@v1
    with:
      # Branch configuration
      base_branch: 'production'  # Default: 'production'
      head_branch: 'main'        # Default: 'main'

      # AI configuration
      ai_provider: 'openai'      # 'openai' or 'none'
      ai_model: 'gpt-5-mini'     # Optional: uses provider default
      ai_temperature: '0.2'      # Optional: 0.0-2.0
      output_language: 'ja'      # Output language (e.g., 'ja', 'en')

      # Label to add to release PR
      release_label: 'release'

      # Path to custom template
      template_path: '.github/release-template.md'
    secrets:
      OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
```

## Required Permissions

When using GitHub Actions, the workflow requires these permissions:

```yaml
permissions:
  contents: read        # Read repository content
  pull-requests: write  # Create and update PRs
  issues: write         # Add labels to PRs
```

## Troubleshooting

### GitHub API Rate Limit

If you encounter rate limit errors:
- The tool automatically retries with exponential backoff
- For large repositories, consider using PR caching (enabled by default)
- Check your token's rate limit: `gh api rate_limit`

### OpenAI API Errors

- Verify `OPENAI_API_KEY` is set correctly
- Check API key permissions at https://platform.openai.com/api-keys
- The tool masks sensitive information before sending to AI

### Template Errors

- Ensure template file exists at the specified path
- Check Eta template syntax: https://eta.js.org/docs/syntax
- `it.llm()` requires `--provider openai` to be set

## Individual Actions

> **Warning**: Individual actions (`smart-pr-release-collect`, `smart-pr-release-render`, `smart-pr-release-create`) are **internal implementation details** and **not supported for standalone use**.
>
> These actions depend on the monorepo structure and will not work when used directly. Please use the [reusable workflow](#using-reusable-workflow-recommended) instead.

## Template Format

Create a `.github/release-template.md` file in your repository (see `release-template-example.md.eta` for a full example):

```eta
Release <%= it.date %>

> This PR body is auto-generated. Manual edits will be overwritten.

### Summary
<%~ await it.llm('Summarize the release in bullet points') %>

### Included Pull Requests
<% it.pullRequests.forEach(pr => { %>
- [ ] #<%= pr.number %> <%= pr.title %> (@<%= pr.author %>)
<% }) %>

### Verification Checklist
<%~ await it.llm('List verification items to check before release') %>
```

The `it.llm(prompt)` function calls the AI provider with the given prompt and inserts the response. This function is only available when `--provider openai` is set.

## Security

- All text is masked for sensitive patterns (API keys, passwords, PII) before being sent to the AI provider
- An aggregate audit log is created per render (recording total prompt size, masked patterns, and duration across all AI calls)
- The audit log is uploaded as a workflow artifact

## Development

```bash
# Install dependencies
pnpm install

# Type check
pnpm run typecheck

# Run tests
pnpm test

# Lint
pnpm run lint
```

## License

MIT License - see [LICENSE](LICENSE) for details.
