---
name: Read Noridoc
description: Read documentation from the server-side noridocs system by file path.
---

# Read Noridoc

Reads documentation from the server-side noridocs system.

## When to Use

Use this when:

- Reading server-side documentation
- Checking documentation version history
- Viewing git repository links for docs

Use regular Read tool instead for:

- Local file contents
- Files not in noridocs system

## Usage

```bash
node ~/.claude/skills/read-noridoc/script.js --filePath="@<repository>/path"
```

## Parameters

- `--filePath` (required): Path in format `@<repository>/<path>` (e.g., "@nori-watchtower/server/src/persistence")
  - Use `@<repository>/path` for repository-scoped docs
  - Use `@/path` for docs in the `no-repository` scope (old format)

## Examples

```bash
# Read repository-scoped noridoc
node ~/.claude/skills/read-noridoc/script.js --filePath="@nori-watchtower/server/src/api"

# Read doc from no-repository scope
node ~/.claude/skills/read-noridoc/script.js --filePath="@/server/src/api"
```

## Output

Returns documentation content with version number, last updated timestamp, and git repository link (if available).

## Requirements

- Paid Nori subscription
- Configured credentials in `~/nori-config.json`
