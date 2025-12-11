---
description: How to invoke subagents via cursor-agent CLI for specialized tasks like web research and code analysis
alwaysApply: false
---

# Using Subagents in Cursor

Subagents are specialized AI assistants that can perform focused tasks. Unlike Claude Code which has a built-in Task tool, Cursor invokes subagents via the `cursor-agent` CLI in headless mode.

## Available Subagents

Subagent prompt files are located in `{{subagents_dir}}/`. Each `.md` file defines a specialized subagent.

| Subagent | Description |
|----------|-------------|
| `nori-web-search-researcher` | Web research specialist for finding documentation, articles, and current information |

## How to Invoke a Subagent

Use the Bash tool to run `cursor-agent` in headless mode:

```bash
cursor-agent -p "Your prompt here" --force
```

### Flags:
- `-p` / `--print`: Non-interactive mode, prints response to console
- `--force`: Allows file modifications without confirmation (use with caution)
- `--output-format text`: Human-readable output (default)

### Example: Web Research

```bash
cursor-agent -p "Research the latest best practices for React Server Components in 2025. Focus on official documentation and recent blog posts." --force
```

### Example: With Subagent Prompt

To use a predefined subagent, pass its instructions as context:

```bash
cursor-agent -p "$(cat {{subagents_dir}}/nori-web-search-researcher.md)

---
USER REQUEST:
Research how to implement OAuth 2.0 PKCE flow in a Next.js application.
" --force
```

## When to Use Subagents

Use subagents when you need:

1. **Focused research** - Web searches, documentation lookups
2. **Specialized analysis** - Code review, pattern finding
3. **Parallel work** - Multiple independent research tasks
4. **Fresh context** - A clean slate for a specific subtask

## Best Practices

1. **Be specific** - Provide clear, detailed prompts
2. **Include context** - Share relevant file paths, requirements
3. **Review results** - Subagent output should be verified before use
4. **Use sparingly** - Only spawn subagents for substantial tasks

## Output Handling

The subagent's response will be printed to the terminal. You can:

1. **Read directly** - View the output in the terminal
2. **Parse programmatically** - Use `--output-format json` for structured output
3. **Redirect to file** - `cursor-agent -p "..." > output.txt`

## Limitations

1. **No built-in Task tool** - Unlike Claude Code, Cursor requires CLI invocation
2. **Single-threaded** - Each invocation is synchronous
3. **Authentication required** - `CURSOR_API_KEY` must be set for headless mode
4. **Context isolation** - Subagents don't share context with the main session

## Troubleshooting

**"cursor-agent not found"**
- Install cursor-agent CLI: `curl https://cursor.com/install -fsSL | bash`

**"Authentication failed"**
- Set your API key: `export CURSOR_API_KEY="your-key"`

**"Rate limited"**
- Wait before making additional requests
- Use subagents sparingly for complex tasks
