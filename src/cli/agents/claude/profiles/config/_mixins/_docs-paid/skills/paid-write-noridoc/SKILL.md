---
name: Write Noridoc
description: Write or update documentation in the server-side noridocs system.
---

# Write Noridoc

Writes documentation to the server-side noridocs system.

## When to Use

Use this when:

- Creating new server-side documentation
- Updating existing noridoc content
- Adding git repository links to docs

Use regular Write tool instead for:

- Local file modifications
- Files not managed by noridocs

## Usage

```bash
node {{skills_dir}}/write-noridoc/script.js --filePath="@<repository>/path" --content="# Documentation" [--gitRepoUrl="https://github.com/..."]
```

## Parameters

- `--filePath` (required): Path in format `@<repository>/<path>` (e.g., `@my-repo/server/src/persistence`)
  - Use `@<repository>/path` for repository-scoped docs
  - Use `@/path` or plain paths for `no-repository` scope (backward compatible)
- `--content` (required): Markdown content
- `--gitRepoUrl` (optional): Link to git repository

## Repository Detection

The repository is automatically extracted from the filePath by the server:

- `@my-repo/server/src/api` → repository: `my-repo`
- `@/server/src/api` → repository: `no-repository`
- `server/src/api` → repository: `no-repository`

Repository names must be **lowercase letters, numbers, and hyphens** only.

## Examples

### Create repository-scoped noridoc

```bash
node {{skills_dir}}/write-noridoc/script.js \
  --filePath="@my-repo/server/src/api" \
  --content="# API Client

Provides access to Nori backend." \
  --gitRepoUrl="https://github.com/username/my-repo"
```

### Create noridoc without repository scope

```bash
node {{skills_dir}}/write-noridoc/script.js \
  --filePath="@/server/src/api" \
  --content="# API Client"
```

## Output

Returns confirmation with version number (creates new version automatically).

## Requirements

- Paid Nori subscription
- Configured credentials in `~/nori-config.json`
