# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

smart-pr-release is an automated release PR generation tool for GitHub repositories with AI-powered summaries using OpenAI.

## Development Commands

```bash
# Install dependencies
pnpm install

# Type check
pnpm run typecheck

# Tests
pnpm test                    # Run all tests
pnpm test:watch              # Watch mode
pnpm test:coverage           # With coverage
pnpm test -- packages/core   # Specific directory only
pnpm test -- mask-sensitive  # Filter by filename

# Lint & Format (Biome)
pnpm run lint                # Lint with auto-fix
pnpm run format              # Format code
pnpm run check               # Lint + format with auto-fix
pnpm run check:ci            # CI mode (no auto-fix)

# Unused dependency check
pnpm run knip

# Run CLI
pnpm run cli -- --help
pnpm run cli -- --repo owner/repo --template .github/release-template.md --provider openai
```

## Architecture

### Monorepo Structure

```
packages/
├── core/           # Core library (@papix/smart-pr-release-core)
│   └── src/
│       ├── index.ts           # Re-exports all modules
│       ├── types.ts           # Shared type definitions (PR, Config, Cache types)
│       ├── cli-types.ts       # CLI/Actions context & dependency injection types
│       ├── config.ts          # Config file loader (.smart-pr-release.yml/.yaml/.json)
│       ├── errors.ts          # Custom error types (SmartPrReleaseError, GitHubApiError)
│       ├── github-api.ts      # GitHub API client with caching
│       ├── mask-sensitive.ts  # Sensitive info masking for LLM
│       └── template.ts        # Restricted template rendering
└── cli/            # CLI tool (@papix/smart-pr-release-cli)
    └── src/
        ├── index.ts           # Commander.js based CLI entry
        └── merge-options.ts   # CLI/Config/Env option merging

actions/            # Reusable GitHub Actions
├── smart-pr-release-collect/     # Metadata collection
├── smart-pr-release-render/      # PR content rendering + AI
└── smart-pr-release-create/      # PR creation/update
```

### Path Aliases

- `#core/*` → `./packages/core/src/*`

### Configuration Files

Config files are loaded from project root (priority: CLI > Config file > Env > Defaults):
- `.smart-pr-release.yml`
- `.smart-pr-release.yaml`
- `.smart-pr-release.json`

### Workflow (3-stage pipeline)

1. **Collect** - Gather PR metadata between base/head branches (with caching)
2. **Render** - Template rendering + AI summary generation
3. **Create** - Create or update release PR

## Code Conventions

- ESM (`"type": "module"`)
- TypeScript strict mode
- No semicolons, 2-space indent
- Coverage threshold: 90%

## Environment Variables

- `GITHUB_TOKEN` - GitHub PAT (required)
- `OPENAI_API_KEY` - OpenAI API key (when using AI)

## Documentation

All documentation, code comments, and commit messages should be written in English.
