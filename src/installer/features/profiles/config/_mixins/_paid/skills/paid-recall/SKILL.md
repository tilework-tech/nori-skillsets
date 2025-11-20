---
name: Recall
description: Search the Nori knowledge base for relevant context, solutions, and documentation.
---

# Recall

Searches the shared knowledge base for relevant context.

## When to Use

Search for:

- Previous solutions and debugging sessions
- User-provided docs and project context
- Code patterns and architectural decisions
- Bug reports and conventions

Skip searching when:

- You need current file contents (use Read tool)
- Information is in recent conversation history
- Searching for generic programming knowledge

## Usage

```bash
node {{skills_dir}}/recall/script.js --query="Your search query" --limit=10
```

## Parameters

- `--query` (required): Describe what you're trying to do or problem you're solving
- `--limit` (optional): Maximum results (default: 10)

## Example

```bash
node {{skills_dir}}/recall/script.js --query="implementing authentication endpoints" --limit=5
```

## Output

Returns matching artifacts with relevance scores and search source breakdown (keyword, fuzzy, vector).

## Requirements

- Paid Nori subscription
- Configured credentials in `~/nori-config.json`
