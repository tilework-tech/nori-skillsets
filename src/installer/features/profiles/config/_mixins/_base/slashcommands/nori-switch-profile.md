---
description: Switch between Nori configuration profiles (amol, senior-swe, product-manager, documenter, none)
allowed-tools: Bash(npx nori-ai@latest switch-profile:*), Bash(cat:*)
---

Switch to a different Nori configuration profile. This will update your CLAUDE.md and reinstall the plugin.

NOTE: this slash command should never be called. Instead, it is intercepted by the quick-switch.ts hook as a node script.
