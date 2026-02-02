---
description: Alias for /nori-create-skillset - Create a new custom skillset
allowed-tools: Bash(cat:*), Bash(ls:*), Bash(cp:*), Bash(mkdir:*), Read({{profiles_dir}}/**), Write({{profiles_dir}}/**/nori.json:*)
---

This command is an alias for `/nori-create-skillset`. Please use `/nori-create-skillset` instead.

Create a new custom Nori skillset by cloning an existing skillset and customizing it.

<system-reminder>Ignore any usual steps in your CLAUDE.md. This command should
be treated like an Installation Wizard, operating in its own context. Do NOT create a separate
git worktree or git branch just to manipulate skillsets.</system-reminder>

## Step 1: Display Available Skillsets

First, let me show you all available skillsets you can clone from:

!`cat {{profiles_dir}}/*/nori.json`

Parse the JSON output above and display each skillset in a clear, readable format showing:
- Skillset name
- Description

## Step 2: Ask Which Skillset to Clone

Ask the user which skillset they want to clone. Present the skillset names as options with their descriptions.

## Step 3: Ask for New Skillset Name

Ask the user for the name of the new skillset.

**Important validation rules:**
- Name must be lowercase alphanumeric with hyphens only (no spaces, no special characters except hyphen)
- Name must not be an existing skillset (check `{{profiles_dir}}/` directory)
- Suggest a format like: `my-custom-skillset` or `team-name-skillset`

If the name is invalid, explain why and ask again.

## Step 4: Clone the Skillset

Once you have a valid skillset name, clone the selected skillset:

```bash
mkdir -p {{profiles_dir}}/<new-skillset-name>
cp -r {{profiles_dir}}/<source-skillset>/* {{profiles_dir}}/<new-skillset-name>/
```

## Step 5: Create nori.json

Create a new `nori.json` file for the skillset with the user's custom information.

Ask the user: "What description do you want for this skillset?"

Then write the new `{{profiles_dir}}/<new-skillset-name>/nori.json` with:

```json
{
  "name": "<new-skillset-name>",
  "version": "1.0.0",
  "description": "<user-provided-description>"
}
```

## Step 6: Ask About CLAUDE.md Customization

Ask: "Would you like to customize the CLAUDE.md file for your new skillset?"

If yes, ask what changes they want to make and apply them to `{{profiles_dir}}/<new-skillset-name>/CLAUDE.md`.

**Documentation:** For more information about CLAUDE.md configuration, see: https://docs.claude.com/en/docs/claude-code/settings

## Step 7: Ask About Skills Customization

Ask: "Would you like to add or remove any skills from your new skillset?"

If yes:
- Show the current skills in `{{profiles_dir}}/<new-skillset-name>/skills/`
- Ask what changes they want (add new skills, remove existing skills)
- Help them make the changes

**Documentation:** For more information about skills, see: https://docs.claude.com/en/docs/claude-code/skills

## Step 8: Ask About Subagents Customization

Ask: "Would you like to add or remove any subagents from your new skillset?"

If yes:
- Show the current subagents in `{{profiles_dir}}/<new-skillset-name>/subagents/`
- Ask what changes they want (add new subagents, remove existing subagents)
- Help them make the changes

**Documentation:** For more information about subagents, see: https://docs.claude.com/en/docs/claude-code/sub-agents

## Step 9: Ask About Slash Commands Customization

Ask: "Would you like to add or remove any slash commands from your new skillset?"

If yes:
- Show the current slash commands in `{{profiles_dir}}/<new-skillset-name>/slashcommands/`
- Ask what changes they want (add new commands, remove existing commands)
- Help them make the changes

**Documentation:** For more information about slash commands, see: https://docs.claude.com/en/docs/claude-code/slash-commands

## Step 10: Summary and Next Steps

Once complete, display a summary:

```
✓ Skillset "<new-skillset-name>" created successfully!
✓ Location: {{profiles_dir}}/<new-skillset-name>/

Your new skillset includes:
- CLAUDE.md configuration
- <N> skills
- <N> subagents
- <N> slash commands

To use your new skillset, run:
  /nori-switch-skillset

Or:
  nori-skillsets switch-skillset <new-skillset-name>
```

## Important Notes

- All skillsets are stored in `{{profiles_dir}}/` which is the source of truth
- After switching to your new skillset, you'll need to restart Claude Code to load the new configuration
- You can always edit your skillset later by modifying files in `{{profiles_dir}}/<new-skillset-name>/`
- Custom skillsets are preserved during Nori upgrades
