---
description: Toggle session transcript summarization on or off
allowed-tools: Read(~/nori-config.json:*), Write(~/nori-config.json:*)
---

Toggle whether session transcripts are sent to Nori Profiles for summarization and storage.

## Your Task

1. Read the current nori-config.json file:

```bash
cat ~/nori-config.json
```

2. Check the current value of `sendSessionTranscript`:
   - If it's `"enabled"`, change it to `"disabled"`
   - If it's `"disabled"`, change it to `"enabled"`
   - If the field doesn't exist, add it with value `"disabled"`

3. Update the ~/nori-config.json file with the new value using the Write tool.

4. Report the new state to the user:
   - If now enabled: "Session transcripts are now ENABLED. Your conversations will be summarized and stored."
   - If now disabled: "Session transcripts are now DISABLED. Your conversations will not be summarized or stored."

## Example

If the current config is:
```json
{
  "username": "user@example.com",
  "password": "password",
  "organizationUrl": "https://example.com"
}
```

And the user wants to disable transcripts, update it to:
```json
{
  "username": "user@example.com",
  "password": "password",
  "organizationUrl": "https://example.com",
  "sendSessionTranscript": "disabled"
}
```
