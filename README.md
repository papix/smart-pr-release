# smart-pr-release

AI-powered release PR automation for GitHub. Automatically creates release PRs and generates AI summaries using OpenAI.

## Packages

This monorepo contains:

| Package | Description |
|---------|-------------|
| [@papix/smart-pr-release-core](./packages/core) | Core library |
| [@papix/smart-pr-release-cli](./packages/cli) | CLI tool |
| [GitHub Actions](./actions) | Reusable GitHub Actions |

The published CLI and core package require Node.js 22.22.1 or later. Development uses Node.js 24.18.0 and pnpm 11.13.1, pinned by `.node-version` and `packageManager`.

## Features

- Automatic release PR creation from merge commits
- AI-powered release summary generation (OpenAI)
- Automatic masking of sensitive information before sending to AI
- Customizable restricted templates and prompts
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
    uses: papix/smart-pr-release/.github/workflows/smart-pr-release.yml@<FULL_COMMIT_SHA>
    secrets: inherit
```

Replace `<FULL_COMMIT_SHA>` with the complete commit SHA for the version you reviewed. Do not use a mutable tag such as `v1`. The reusable workflow checks out its implementation at that same SHA and uses its own pinned Node.js 24.18.0 and pnpm 11.13.1 toolchain, independent of the caller repository's `package.json` and lockfile.

### Configuration Options

```yaml
jobs:
  smart-pr-release:
    uses: papix/smart-pr-release/.github/workflows/smart-pr-release.yml@<FULL_COMMIT_SHA>
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

      # Runner label for both jobs
      runs_on: 'toggle-ci-runner-local-cache' # Default: 'ubuntu-latest'
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
- Use only the restricted tags documented below; arbitrary JavaScript and legacy Eta tags are rejected
- `{{ llm "prompt" }}` requires `--provider openai` to be set

## Individual Actions

> **Warning**: Individual actions (`smart-pr-release-collect`, `smart-pr-release-render`, `smart-pr-release-create`) are **internal implementation details** and **not supported for standalone use**.
>
> These actions depend on the monorepo structure and will not work when used directly. Please use the [reusable workflow](#using-reusable-workflow-recommended) instead.

## Template Format

Create a `.github/release-template.md` file in your repository (see `release-template-example.md` for a full example):

```markdown
Release {{ date }}

> This PR body is auto-generated. Manual edits will be overwritten.

### Summary
{{ llm "Summarize the release in bullet points" }}

### Included Pull Requests
{{#pullRequests}}
- [ ] #{{ number }} {{ title }} (@{{ author }})
{{/pullRequests}}

### Verification Checklist
{{ llm "List verification items to check before release" }}
```

Supported tags are `{{ date }}`, the `{{#pullRequests}}` section with `{{ number }}`, `{{ title }}`, and `{{ author }}`, and `{{ llm "prompt" }}`. LLM prompts use JSON string escaping. The LLM tag calls the configured AI provider and inserts the response; it is only available when `--provider openai` is set. Templates are parsed with an allowlist and are never evaluated as JavaScript.

Templates are limited to 65,536 characters, at most four LLM tags, and 4,096 characters per LLM prompt. LLM tags are not allowed inside `{{#pullRequests}}` sections. These limits are validated before the first external AI request.

Each LLM response is limited to 16,384 UTF-16 code units and is parsed as CommonMark before insertion. Only paragraphs, headings, lists, emphasis, strong text, inline/code blocks, hard breaks, thematic breaks, and text are preserved. Links are reduced to their labels, images to alt text, block quotes to their contents, definitions are removed, and raw HTML is rendered harmless with full-width delimiters. Outside code, URL schemes, `www.`, mentions, and GitHub-style issue references are neutralized. Unicode bidirectional controls are replaced everywhere. The sanitized result is serialized, parsed again, and rejected if any unsafe structure or lexical form remains.

Rendered release titles and bodies are validated twice: immediately after rendering and before the GitHub client or create/update API is used. Titles must be non-empty after trimming, at most 256 UTF-16 code units, and contain no newline, C0, or DEL control characters. Bodies may be empty, are limited to 65,536 UTF-16 code units, and permit only TAB, LF, and CR among C0 controls. Invalid content is rejected rather than truncated or normalized.

### Migrating from Eta templates

The restricted template format is a breaking change independent of the Node.js 20 support removal. Legacy Eta tags such as `<%= ... %>` are rejected; migrate them to the supported tags above.

When updating an existing caller to a commit containing this change, update its template and the reusable workflow's full commit SHA together. The first canary must include both changes. Do not update only the workflow SHA while leaving an Eta template in place. After the migrated-template canary succeeds, update the caller's Node.js and pnpm toolchain separately if needed.

## Security

- All text is masked for sensitive patterns (API keys, passwords, PII) before being sent to the AI provider
- Caller-controlled templates cannot execute JavaScript or read workflow environment variables
- Template files must resolve within the caller repository workspace, including after symlink resolution
- Template and LLM-call limits are validated before any paid API request
- Rendering runs with read-only repository permissions; PR writes run later in a separate job from a fresh action checkout
- An aggregate audit log is created per render after the first AI request starts, including call count, prompt size, masked-pattern count, output-sanitization count, duration, success/failure status, and a stable non-sensitive error code
- A failed audit write rejects the rendered result; prompts, PR data, LLM output, URLs, mentions, secrets, and raw exception messages are never written to the audit entry
- The audit log is uploaded as a workflow artifact
- Repository-specific custom autolinks and GitHub's implicit commit-SHA links cannot be resolved during rendering and remain a documented residual risk; review generated release PRs and configure repository autolinks accordingly

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
