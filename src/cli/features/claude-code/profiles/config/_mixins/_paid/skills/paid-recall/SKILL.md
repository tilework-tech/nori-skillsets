---
name: Recall
description: Search the Nori knowledge base for relevant context, solutions, and documentation.
---

# Recall

Searches the shared knowledge base for relevant context or fetches specific articles by ID.

## When to Use

**Search mode** - Search for:

- Previous solutions and debugging sessions
- User-provided docs and project context
- Code patterns and architectural decisions
- Bug reports and conventions

**Fetch mode** - Retrieve full article when:

- You have an article ID from search results
- You need complete article content (not just snippets)
- You want to dig deeper into a specific result

Skip recall when:

- You need on-disk file contents (use Read tool)
- Information is in recent conversation history
- Searching for generic programming knowledge

## Usage

Recall is a programmatic google search for internal documents. The search mode gives you snippets. The fetch mode lets you see the full data of those snippets. The best way to use this tool is to iterate back and forth between search and fetch mode.
- Search for something.
- Fetch the data that makes the most sense based on the snippets.
- Read the returned articles in full.
- Decide if there is something else that is worth searching for based on what you learned.
- Repeat.

If you do not find anything in the first search, simply search again with different terms.

### Search Mode

```bash
node {{skills_dir}}/recall/script.js --query="Your search query" --limit=10
```

### Fetch Mode

```bash
node {{skills_dir}}/recall/script.js --id="article_id"
```

## Examples

### Search for articles

```bash
node {{skills_dir}}/recall/script.js --query="implementing authentication endpoints" --limit=5
```

### Fetch specific article

```bash
node {{skills_dir}}/recall/script.js --id="nori_abc123def456"
```

## Output

**Search mode**: Returns article snippets (truncated to 500 chars) with metadata and search source breakdown (keyword, fuzzy, vector).

**Fetch mode**: Returns complete article content without truncation, including full metadata (name, ID, type, repository, timestamps).

## Requirements

- Paid Nori subscription
- Configured credentials in `~/nori-config.json`
