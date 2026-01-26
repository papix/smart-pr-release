# Contributing to smart-pr-release

Thank you for your interest in contributing to smart-pr-release! This document provides guidelines and instructions for contributing.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Making Changes](#making-changes)
- [Commit Message Guidelines](#commit-message-guidelines)
- [Pull Request Process](#pull-request-process)
- [Testing](#testing)
- [Code Style](#code-style)
- [Release Process](#release-process)

## Code of Conduct

Please be respectful and constructive in all interactions. We aim to maintain a welcoming environment for all contributors.

## Getting Started

1. Fork the repository
2. Clone your fork locally
3. Set up the development environment (see below)
4. Create a new branch for your changes
5. Make your changes
6. Submit a pull request

## Development Setup

### Prerequisites

- **Node.js**: v20.x or later (LTS recommended)
- **pnpm**: v9.x or later

### Installation

```bash
# Clone the repository
git clone https://github.com/papix/smart-pr-release.git
cd smart-pr-release

# Install dependencies
pnpm install

# Verify setup
pnpm run typecheck
pnpm test
```

### Environment Variables

For local development, create a `.env.local` file (not tracked by git):

```bash
GITHUB_TOKEN=your_github_token
OPENAI_API_KEY=your_openai_key  # Optional, for AI features
```

## Making Changes

### Branch Naming

Use descriptive branch names:

- `feature/add-new-provider` - New features
- `fix/template-parsing-error` - Bug fixes
- `docs/update-readme` - Documentation updates
- `refactor/simplify-api-client` - Code refactoring

### Development Commands

```bash
# Type checking
pnpm run typecheck

# Run tests
pnpm test                    # All tests
pnpm test:watch              # Watch mode
pnpm test:coverage           # With coverage report
pnpm test -- packages/core   # Specific package

# Lint and format
pnpm run lint                # Lint with auto-fix
pnpm run format              # Format code
pnpm run check               # Lint + format with auto-fix
pnpm run check:ci            # CI mode (no auto-fix)

# Check for unused dependencies
pnpm run knip

# Run CLI locally
pnpm run cli -- --help
```

## Commit Message Guidelines

This project uses [Conventional Commits](https://www.conventionalcommits.org/) enforced by [commitlint](https://commitlint.js.org/).

### Format

```
<type>(<scope>): <subject>

[optional body]

[optional footer(s)]
```

### Types

- `feat`: A new feature
- `fix`: A bug fix
- `docs`: Documentation only changes
- `style`: Changes that do not affect the meaning of the code
- `refactor`: A code change that neither fixes a bug nor adds a feature
- `perf`: A code change that improves performance
- `test`: Adding missing tests or correcting existing tests
- `build`: Changes that affect the build system or external dependencies
- `ci`: Changes to CI configuration files and scripts
- `chore`: Other changes that don't modify src or test files

### Scopes

- `core`: Changes to `packages/core`
- `cli`: Changes to `packages/cli`
- `actions`: Changes to GitHub Actions in `actions/`
- `deps`: Dependency updates

### Examples

```
feat(core): add support for custom AI providers
fix(cli): handle missing template file gracefully
docs: update installation instructions
test(core): add tests for mask-sensitive module
ci: add automated release workflow
```

### Pre-commit Hooks

Git hooks are configured via [Husky](https://typicode.github.io/husky/):

- **commit-msg**: Validates commit message format
- **pre-commit**: Runs lint and format checks
- **pre-push**: Runs type check and tests

## Pull Request Process

1. **Update your fork**: Ensure your branch is up to date with `main`
2. **Run checks locally**: `pnpm run check:ci && pnpm run typecheck && pnpm test`
3. **Create PR**: Use the PR template and fill in all sections
4. **Link issues**: Reference related issues with `Fixes #123` or `Closes #123`
5. **Wait for review**: Address any feedback from reviewers
6. **Squash and merge**: PRs are typically squash-merged

### PR Checklist

- [ ] Tests added/updated for changes
- [ ] Documentation updated if needed
- [ ] All CI checks pass
- [ ] PR description clearly explains the changes

## Testing

### Requirements

- **Coverage threshold**: 90% (enforced in CI)
- All new features must include tests
- Bug fixes should include regression tests

### Running Tests

```bash
# Run all tests
pnpm test

# Run with coverage
pnpm test:coverage

# Run specific tests
pnpm test -- packages/core
pnpm test -- mask-sensitive
```

### Test Structure

Tests are co-located with source files:

```
packages/core/src/
├── template.ts
├── template.test.ts
├── mask-sensitive.ts
└── mask-sensitive.test.ts
```

## Code Style

This project uses [Biome](https://biomejs.dev/) for linting and formatting.

### Key Rules

- **ESM**: ES Modules (`"type": "module"`)
- **TypeScript**: Strict mode enabled
- **Formatting**: No semicolons, 2-space indentation
- **Imports**: Use path aliases (`#core/*`)

### Auto-fix

```bash
# Fix all issues
pnpm run check

# Check only (CI mode)
pnpm run check:ci
```

## Release Process

Releases are automated via GitHub Actions:

1. Changes merged to `main` trigger the release workflow
2. Version is bumped based on commit types (semantic versioning)
3. Changelog is generated from commit messages
4. Packages are published to npm

### Versioning

- `feat`: Minor version bump (0.x.0)
- `fix`: Patch version bump (0.0.x)
- `BREAKING CHANGE`: Major version bump (x.0.0)

## Questions?

If you have questions or need help, please:

1. Check existing [issues](https://github.com/papix/smart-pr-release/issues)
2. Open a new issue with your question
3. Review the [README](README.md) and [CLAUDE.md](CLAUDE.md) for documentation

Thank you for contributing!
