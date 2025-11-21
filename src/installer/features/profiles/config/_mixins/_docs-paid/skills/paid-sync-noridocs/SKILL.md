---
name: Sync Noridocs
description: Sync all local docs.md files to server-side noridocs system.
---

# Sync Noridocs

Finds all Git-tracked docs.md files in the codebase and syncs them to the server-side noridocs system.

## When to Use

Use this when:

- You want to sync all local documentation to the server
- You've made changes to multiple docs.md files
- You want to ensure server-side docs are up to date with local files

Use write-noridoc instead for:

- Updating a single specific noridoc
- Creating new documentation that doesn't exist locally

## Usage

```bash
node {{skills_dir}}/nori-sync-docs/script.js [--delay=500] [--gitRepoUrl="https://github.com/..."]
```

## Parameters

- `--delay` (optional): Milliseconds to wait between API calls (default: 500)
- `--gitRepoUrl` (optional): Git repository URL to associate with all docs (auto-detected from `git remote get-url origin` if not provided)

## Examples

```bash
# Sync all docs with default settings
node {{skills_dir}}/nori-sync-docs/script.js

# Sync with custom delay to avoid rate limits
node {{skills_dir}}/nori-sync-docs/script.js --delay=1000

# Sync with git repository URL
node {{skills_dir}}/nori-sync-docs/script.js --gitRepoUrl="https://github.com/username/repo"
```

## Output

Shows progress as each file is synced, with a summary at the end:
- Number of files found
- Number successfully synced
- Number failed (with error details)

## Requirements

- Paid Nori subscription
- Configured credentials in `~/nori-config.json`
- Local docs.md files with valid `Path:` headers

## Notes

- Uses `git ls-files` to find only Git-tracked docs.md files
- Automatically excludes untracked and gitignored files
- Auto-detects Git remote URL from `origin` remote if not explicitly provided
- Only syncs files with valid `Path:` field in the header
- Repository is extracted from the `Path:` field by the server
- Rate limiting prevents Firebase errors on large syncs
- Continues processing even if individual files fail
