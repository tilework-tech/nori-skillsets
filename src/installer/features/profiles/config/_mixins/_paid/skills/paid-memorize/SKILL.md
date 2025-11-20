---
name: Memorize
description: Use this to save important implementation decisions, patterns, or context to the Nori knowledge base for future sessions.
---

# Memorize

Saves information to a shared knowledge base for future reference.

## When to Use

Memorize for:

- Accomplishments and implementation approaches
- Key decisions and rationale
- Non-obvious solutions and workarounds
- Project-specific patterns and conventions
- User preferences

Skip memorizing:

- Trivial changes with no decisions
- Generic knowledge
- Temporary debugging output

## Usage

```bash
node {{skills_dir}}/memorize/script.js --name="Memory Title" --content="Detailed content here"
```

## Parameters

- `--name` (required): Clear, searchable title for the memory
- `--content` (required): Markdown content with context, decisions, code snippets

## Example

```bash
node {{skills_dir}}/memorize/script.js \
  --name="TDD workflow for React components" \
  --content="# TDD Process\n\n1. Write failing test\n2. Implement component\n3. Verify test passes"
```

## Output

Returns confirmation with artifact ID and timestamps.

## Requirements

- Paid Nori subscription
- Configured credentials in `~/nori-config.json`
