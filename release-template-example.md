Release {{ date }}

> This PR body is auto-generated. Manual edits will be overwritten.

### Summary
{{ llm "Summarize all PRs in 3-5 bullet points, group related PRs by theme with PR numbers, and focus on the release overview instead of listing each PR separately." }}

### Included Pull Requests
{{#pullRequests}}
- [ ] #{{ number }} {{ title }} (@{{ author }})
{{/pullRequests}}

### Verification Checklist
{{ llm "List verification items to check before release as Markdown checkboxes, place critical checks first with a :warning: prefix, and include relevant PR numbers." }}
