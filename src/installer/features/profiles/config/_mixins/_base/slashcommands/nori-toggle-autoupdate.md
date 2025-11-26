---
description: Toggle automatic updates on or off
allowed-tools: Read(**/.nori-config.json:*), Write(**/.nori-config.json:*)
---

Toggle whether Nori Profiles automatically updates when a new version is available.

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

2. Check the current value of `autoupdate`:
   - If it's `"enabled"`, change it to `"disabled"`
   - If it's `"disabled"`, change it to `"enabled"`
   - If the field doesn't exist, add it with value `"disabled"` (since default is enabled)

3. Update the .nori-config.json file (at the path discovered in step 1) with the new value using the Write tool.

4. Report the new state to the user:
   - If now enabled: "Autoupdate is now ENABLED. Nori Profiles will automatically update when a new version is available."
   - If now disabled: "Autoupdate is now DISABLED. You will be notified of new versions but must update manually with 'npx nori-ai install'."

## Example

If the current config is:
```json
{
  "profile": {
    "baseProfile": "senior-swe"
  },
  "installDir": "/home/user/.claude"
}
```

And the user wants to disable autoupdate, update it to:
```json
{
  "profile": {
    "baseProfile": "senior-swe"
  },
  "installDir": "/home/user/.claude",
  "autoupdate": "disabled"
}
```
