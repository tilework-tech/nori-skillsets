---
description: Sync all docs.md files to server-side noridocs
allowed-tools: Bash(node {{skills_dir}}/nori-sync-docs/script.js:*)
---

Sync all local docs.md files in the codebase to the server-side noridocs system.

Run the nori-sync-docs skill:

```bash
node {{skills_dir}}/nori-sync-docs/script.js
```

This will:
- Find all docs.md files in the codebase
- Extract the Path: field from each file
- Sync them to the server-side noridocs system
- Add rate limiting to avoid Firebase errors
- Report a summary of successful and failed syncs
