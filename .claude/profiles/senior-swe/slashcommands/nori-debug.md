---
description: Validate Nori Agent Brain installation and configuration
---

!`npx nori-ai check`

This validates the Nori Agent Brain installation:

- Config file structure and credentials
- Server authentication (paid mode only)
- Hooks configuration in .claude/settings.json
- Subagent files in ~/.claude/agents/
- Slash command files in ~/.claude/commands/
- CLAUDE.md managed block
- MCP server registration (paid mode only)

## Troubleshooting

If you encounter installation issues, check the installer log file:

```bash
cat /tmp/nori-installer.log
```

This log contains detailed information about the installation process and any errors encountered.
