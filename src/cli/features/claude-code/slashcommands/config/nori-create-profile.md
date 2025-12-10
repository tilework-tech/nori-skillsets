---
description: Create a new custom profile by cloning an existing profile
allowed-tools: Bash(cat:*), Bash(ls:*), Bash(cp:*), Bash(mkdir:*), Read({{profiles_dir}}/**), Write({{profiles_dir}}/**/profile.json:*)
---

Create a new custom Nori profile by cloning an existing profile and customizing it.

<system-reminder>Ignore any usual steps in your CLAUDE.md. This command should
be treated like an Installation Wizard, operating in its own context. Do NOT create a separate
git worktree or git branch just to manipulate profiles.</system-reminder>

## Step 1: Display Available Profiles

First, let me show you all available profiles you can clone from:

!`cat {{profiles_dir}}/*/profile.json`

Parse the JSON output above and display each profile in a clear, readable format showing:
- Profile name
- Description

## Step 2: Ask Which Profile to Clone

Ask the user which profile they want to clone. Present the profile names as options with their descriptions.

## Step 3: Ask for New Profile Name

Ask the user for the name of the new profile.

**Important validation rules:**
- Name must be lowercase alphanumeric with hyphens only (no spaces, no special characters except hyphen)
- Name must not be an existing profile (check `{{profiles_dir}}/` directory)
- Suggest a format like: `my-custom-profile` or `team-name-profile`

If the name is invalid, explain why and ask again.

## Step 4: Clone the Profile

Once you have a valid profile name, clone the selected profile:

```bash
mkdir -p {{profiles_dir}}/<new-profile-name>
cp -r {{profiles_dir}}/<source-profile>/* {{profiles_dir}}/<new-profile-name>/
```

## Step 5: Create profile.json

Create a new `profile.json` file for the profile with the user's custom information.

Ask the user: "What description do you want for this profile?"

Then write the new `{{profiles_dir}}/<new-profile-name>/profile.json` with:

```json
{
  "name": "<new-profile-name>",
  "description": "<user-provided-description>",
  "builtin": false,
  "mixins": {
    "base": {},
    "docs": {},
    "swe": {}
  }
}
```

Copy the mixins object exactly from the source profile's profile.json.

## Step 6: Ask About CLAUDE.md Customization

Ask: "Would you like to customize the CLAUDE.md file for your new profile?"

If yes, ask what changes they want to make and apply them to `{{profiles_dir}}/<new-profile-name>/CLAUDE.md`.

**Documentation:** For more information about CLAUDE.md configuration, see: https://docs.claude.com/en/docs/claude-code/settings

## Step 7: Ask About Skills Customization

Ask: "Would you like to add or remove any skills from your new profile?"

If yes:
- Show the current skills in `{{profiles_dir}}/<new-profile-name>/skills/`
- Ask what changes they want (add new skills, remove existing skills)
- Help them make the changes

**Documentation:** For more information about skills, see: https://docs.claude.com/en/docs/claude-code/skills

## Step 8: Ask About Subagents Customization

Ask: "Would you like to add or remove any subagents from your new profile?"

If yes:
- Show the current subagents in `{{profiles_dir}}/<new-profile-name>/subagents/`
- Ask what changes they want (add new subagents, remove existing subagents)
- Help them make the changes

**Documentation:** For more information about subagents, see: https://docs.claude.com/en/docs/claude-code/sub-agents

## Step 9: Ask About Slash Commands Customization

Ask: "Would you like to add or remove any slash commands from your new profile?"

If yes:
- Show the current slash commands in `{{profiles_dir}}/<new-profile-name>/slashcommands/`
- Ask what changes they want (add new commands, remove existing commands)
- Help them make the changes

**Documentation:** For more information about slash commands, see: https://docs.claude.com/en/docs/claude-code/slash-commands

## Step 10: Summary and Next Steps

Once complete, display a summary:

```
✓ Profile "<new-profile-name>" created successfully!
✓ Location: {{profiles_dir}}/<new-profile-name>/

Your new profile includes:
- CLAUDE.md configuration
- <N> skills
- <N> subagents
- <N> slash commands

To use your new profile, run:
  /nori-switch-profile

Or:
  nori-ai switch-profile <new-profile-name>
```

## Important Notes

- All profiles are stored in `{{profiles_dir}}/` which is the source of truth
- After switching to your new profile, you'll need to restart Claude Code to load the new configuration
- You can always edit your profile later by modifying files in `{{profiles_dir}}/<new-profile-name>/`
- Custom profiles (builtin: false) are preserved during Nori upgrades
