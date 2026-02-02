---
description: Upload a profile to the Nori registry
allowed-tools: Bash(nori-skillsets:*)
---

Upload a local skillset to the Nori package registry.

Usage: /nori-registry-upload <profile-name> [version]

Examples:
- /nori-registry-upload my-skillset
- /nori-registry-upload my-skillset 1.0.0

This command packages the specified skillset and uploads it to the Nori registry.

Requires registry authentication configured in .nori-config.json.
