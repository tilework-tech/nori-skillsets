---
description: How to invoke subagents via cursor-agent CLI for specialized tasks like web research and code analysis
alwaysApply: false
---

<required>
**CRITICAL**: Add the following to your Todo list using `todo_write`:

1. Look for the requested subagent in `{{subagents_dir}}/`
2. Make sure the cursor-agent is installed using `cursor-agent --version`.
  - If it is not, ask the user for permission to install. Then run: `curl https://cursor.com/install -fsS | bash`
3. Call `cursor-agent` using the Bash tool in headless mode. **You MUST include the shared subagent prompt at the very top of every subagent call** by cat-ing `{{rules_dir}}/using-subagents/subagent-prompt.txt` before the subagent-specific content:

```bash
cursor-agent -p "$(cat {{rules_dir}}/using-subagents/subagent-prompt.txt)

$(cat {{subagents_dir}}/nori-web-search-researcher.md)

---
USER REQUEST:
Research how to implement OAuth 2.0 PKCE flow in a Next.js application.
" --force --model auto
```

<system-reminder>You should set the model to auto to avoid issues with api keys!</system-reminder>

4. Parse the subagent behavior and choose how to respond.
</required>

# Using Subagents in Cursor

Subagents are specialized AI assistants that can perform focused tasks. Unlike Claude Code which has a built-in Task tool, Cursor invokes subagents via the `cursor-agent` CLI in headless mode.

## How to Invoke a Subagent

Use the Bash tool to run `cursor-agent` in headless mode:

```bash
cursor-agent -p "Your prompt here" --force
```

### Flags:
- `-p` / `--print`: Non-interactive mode, prints response to console
- `--force`: Allows file modifications without confirmation (use with caution)
- `--output-format text`: Human-readable output (default)
- `--model <modelname>`: Use different models

### Example: Web Research

```bash
cursor-agent -p "Research the latest best practices for React Server Components in 2025. Focus on official documentation and recent blog posts." --force
```

### Example: With Subagent Prompt

To use a predefined subagent, **always include the shared subagent prompt first**, then pass its instructions as context:

```bash
cursor-agent -p "$(cat {{rules_dir}}/using-subagents/subagent-prompt.txt)

$(cat {{subagents_dir}}/nori-web-search-researcher.md)

---
USER REQUEST:
Research how to implement OAuth 2.0 PKCE flow in a Next.js application.
" --force --model auto
```

## Output Handling

The subagent's response will be printed to the terminal. You can:

1. **Read directly** - View the output in the terminal
2. **Parse programmatically** - Use `--output-format json` for structured output
3. **Redirect to file** - `cursor-agent -p "..." > output.txt`

## Troubleshooting

**"cursor-agent not found"**
- Install cursor-agent CLI: `curl https://cursor.com/install -fsSL | bash`

**"Authentication failed"**
- Try using `--model auto`
- Set your API key: `export CURSOR_API_KEY="your-key"`

**"Rate limited"**
- Wait before making additional requests
