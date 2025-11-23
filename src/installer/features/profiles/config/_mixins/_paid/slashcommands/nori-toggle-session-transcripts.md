---
description: Toggle session transcript summarization on or off
allowed-tools: Read(**/.nori-config.json:*), Write(**/.nori-config.json:*)
---

Toggle whether session transcripts are sent to Nori Profiles for summarization and storage.

## Your Task

1. Find and read the current nori-config.json file:

```bash
# Find .nori-config.json by walking up directories
config_path=""
current_dir=$(pwd)
while [ "$current_dir" != "/" ]; do
  if [ -f "$current_dir/.nori-config.json" ]; then
    config_path="$current_dir/.nori-config.json"
    break
  fi
  current_dir=$(dirname "$current_dir")
done

if [ -z "$config_path" ]; then
  echo "Error: No Nori installation found. Could not locate .nori-config.json"
  exit 1
fi

# Display the config path and contents
echo "Found config at: $config_path"
cat "$config_path"
```

2. Check the current value of `sendSessionTranscript`:
   - If it's `"enabled"`, change it to `"disabled"`
   - If it's `"disabled"`, change it to `"enabled"`
   - If the field doesn't exist, add it with value `"disabled"`

3. Update the .nori-config.json file (at the path discovered in step 1) with the new value using the Write tool.

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
