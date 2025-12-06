---
description: Upload a profile to the Nori registry
allowed-tools: Bash(nori-ai:*)
---

Upload a local profile to the Nori package registry.

Usage: /nori-registry-upload <profile-name> [version]

Examples:
- /nori-registry-upload my-profile
- /nori-registry-upload my-profile 1.0.0

This command packages the specified profile and uploads it to the Nori registry.

Requires registry authentication configured in .nori-config.json.
