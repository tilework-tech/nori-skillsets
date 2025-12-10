---
description: Validate Nori Profiles installation and configuration
allowed-tools: Bash(nori-ai:*)
---

!`nori-ai check`

This validates the Nori Profiles installation:

- Config file structure and credentials
- Server authentication (paid mode only)
- Hooks configuration in .claude/settings.json
- Subagent files in ~/.claude/agents/
- Slash command files in ~/.claude/commands/
- CLAUDE.md managed block

## Troubleshooting

If you encounter installation issues, check the installer log file:

```bash
cat /tmp/nori-installer.log
```

This log contains detailed information about the installation process and any errors encountered.
