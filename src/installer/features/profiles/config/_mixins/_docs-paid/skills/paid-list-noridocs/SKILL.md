---
name: List Noridocs
description: List all server-side noridocs, optionally filtered by repository and/or path prefix.
---

# List Noridocs

Lists all noridocs, optionally filtered by repository and/or path prefix.

## When to Use

Use this when:

- Exploring available server-side documentation
- Finding docs in a specific repository
- Finding docs in a specific directory/module
- Checking what documentation exists

## Usage

```bash
node ~/.claude/skills/list-noridocs/script.js [--repository="repo-name"] [--pathPrefix="@/server"] [--limit=100]
```

## Parameters

- `--repository` (optional): Filter by repository name (e.g., "nori-watchtower", "no-repository")
- `--pathPrefix` (optional): Filter by prefix like "@/server" or "@nori-watchtower/server"
- `--limit` (optional): Maximum results (default: 100)

## Examples

```bash
# List all noridocs
node ~/.claude/skills/list-noridocs/script.js

# List noridocs in nori-watchtower repository
node ~/.claude/skills/list-noridocs/script.js --repository="nori-watchtower"

# List noridocs under server directory (any repository)
node ~/.claude/skills/list-noridocs/script.js --pathPrefix="@/server"

# Combine repository and path filtering
node ~/.claude/skills/list-noridocs/script.js --repository="nori-watchtower" --pathPrefix="@nori-watchtower/server"

# List with custom limit
node ~/.claude/skills/list-noridocs/script.js --repository="nori-watchtower" --limit=50
```

## Repository Filtering

- Use `--repository` to filter by repository scope
- Repository names match those in the `@<repository>/path` format
- Use `"no-repository"` to find docs without a repository scope (old `@/` format)
- Server-side filtering is more efficient than client-side path filtering

## Output

Returns list of noridoc paths with last updated timestamps.

## Requirements

- Paid Nori subscription
- Configured credentials in `~/nori-config.json`
