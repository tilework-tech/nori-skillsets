---
description: Switch between Nori configuration profiles (amol, senior-swe, product-manager, documenter, none)
allowed-tools: Bash(npx nori-ai@latest switch-profile:*), Bash(cat:*)
---

Switch to a different Nori configuration profile. This will update your CLAUDE.md and reinstall the plugin.

## Available Profiles

Profile descriptions:

!`cat ~/.claude/profiles/*/profile.json`

Parse the JSON output above and display each profile's name and description in a clear, readable format.

## Your Task

Ask me which profile I want to switch to, then run:

```bash
npx nori-ai@latest switch-profile <profile-name>
```

## What Gets Changed

Profile switching:

- ✅ **Copies**: Entire profile directory structure (CLAUDE.md, skills/, slashcommands/, subagents/)
- ✅ **Reinstalls**: All features with the new profile's configuration

## Examples

```bash
# Switch to amol profile (full autonomy)
npx nori-ai@latest switch-profile amol

# Switch to senior-swe profile (co-pilot mode)
npx nori-ai@latest switch-profile senior-swe

# Switch to product-manager profile
npx nori-ai@latest switch-profile product-manager
```
