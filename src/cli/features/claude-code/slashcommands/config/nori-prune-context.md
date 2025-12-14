---
description: Clear accumulated permissions to reduce context token usage
---

Clears the `permissions.allow` array from your `settings.local.json` files to reduce context token usage.

This command is intercepted by a hook and executed directly without LLM processing.

**Usage:** `/nori-prune-context`

**What it does:**

- Clears accumulated bash permissions from `~/.claude/settings.local.json`
- Clears accumulated bash permissions from `.claude/settings.local.json` (project-level)
- Creates backups before modifying (`.backup` suffix)
- Preserves `deny` and `ask` permissions (these are intentional security choices)

**Why use it:**

Claude Code accumulates specific command permissions over time (e.g., `Bash(git push)`, `Bash(npm test)`). These get embedded in the system prompt and consume context tokens. A large permissions file (800+ entries) can consume 20k+ tokens before your conversation even starts.

**After pruning:**

You'll need to re-approve commands as you use them. Consider using broader permission patterns in your `settings.json` instead of accumulating specific commands:

```json
{
  "permissions": {
    "allow": ["Bash(git:*)", "Bash(npm:*)"]
  }
}
```
