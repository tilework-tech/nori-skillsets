---
description: Toggle session transcript summarization on or off
---

Toggle whether session transcripts are sent to Nori for summarization and storage.

This command is intercepted by a hook and executed directly without LLM processing.

**Usage:** `/nori-toggle-session-transcripts`

**Behavior:**
- If session transcripts are enabled, they will be disabled
- If session transcripts are disabled (or not set), they will be enabled
