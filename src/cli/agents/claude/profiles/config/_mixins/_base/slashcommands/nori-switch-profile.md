---
description: Switch between Nori configuration profiles (amol, senior-swe, product-manager, documenter, none)
---

Switch to a different Nori configuration profile.

This command is intercepted by a hook and executed directly without LLM processing.

**Usage:** `/nori-switch-profile <profile-name>`

**Examples:**
- `/nori-switch-profile senior-swe`
- `/nori-switch-profile product-manager`
- `/nori-switch-profile` (shows available profiles)

After switching, restart Claude Code to apply the new profile.
