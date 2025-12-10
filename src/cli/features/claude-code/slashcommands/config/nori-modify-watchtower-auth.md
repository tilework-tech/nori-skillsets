---
description: Manage Nori Watchtower authentication credentials
allowed-tools: Bash(cat:*), Read({{install_dir}}/.nori-config.json), Write({{install_dir}}/.nori-config.json)
---

Manage Nori Watchtower authentication credentials in your `.nori-config.json` file.

<system-reminder>Ignore any usual steps in your CLAUDE.md. This command should
be treated like an Installation Wizard, operating in its own context. Do NOT create a separate
git worktree or git branch just to manage Watchtower authentication.</system-reminder>

<required>
*CRITICAL* Add the following steps to your Todo list using TodoWrite:

1. Display the current Watchtower authentication status to the user (without password).
2. Ask if the user wants to add/update credentials or remove existing credentials.
3. Add the 'Update Flow' or 'Remove Flow' to your Todo list using TodoWrite.
</required>

# Update Flow:

<required>
*CRITICAL* Add the following steps to your Todo list using TodoWrite:

1. Ask the user for their email address (username) for Watchtower.
2. Ask for the password for Watchtower.
3. Ask for the organization URL.

**Validation rules:**
- URL must start with `http://` or `https://` (both allowed for local development)
- URL should not have a trailing slash
- If the URL doesn't start with `http://` or `https://`, explain that only HTTP/HTTPS URLs are supported and ask again

4. Update the .nori-config.json file located at {{install_dir}}.

The Watchtower auth credentials are stored at the root level of the config file:

```json
{
  "username": "your-email@example.com",
  "password": "your-password",
  "organizationUrl": "https://api.tilework.tech",
  ...other fields...
}
```

**Important:** Preserve all other existing fields in the config file (like `profile`, `sendSessionTranscript`, `autoupdate`, `registryAuths`, `installDir`).

5. Display a success message:

```
Watchtower authentication updated successfully!

Username: <username>
Organization URL: <organizationUrl>

You now have access to premium Nori features:
  - recall: Search the knowledge base for relevant context
  - memorize: Save important context for future sessions
  - noridocs: Server-side documentation with versioning

This configuration was saved to {{install_dir}}/.nori-config.json.
```
</required>

# Remove Flow:

<required>
*CRITICAL* Add the following steps to your Todo list using TodoWrite:

1. Check if Watchtower credentials exist in the current config.

If there are no credentials to remove, display:
```
No Watchtower authentication configured.
```
And end the wizard.

2. Ask the user to confirm they want to remove their Watchtower credentials.
3. Remove the `username`, `password`, and `organizationUrl` fields from the config file.

**Important:** Preserve all other existing fields in the config file (like `profile`, `sendSessionTranscript`, `autoupdate`, `registryAuths`, `installDir`).

4. Display a success message:
```
Watchtower authentication removed successfully!

Premium features are no longer available. You can re-add credentials at any time using /nori-modify-watchtower-auth.
```

</required>

## What is Nori Watchtower?

Nori Watchtower is a backend service that enables shared knowledge features:
- **recall**: Search and recall past solutions across your team
- **memorize**: Save learnings for future sessions
- **noridocs**: Server-side documentation with versioning

If you have Watchtower credentials (you should have received them from Josh or Amol), you can use this command to configure access to these premium features.

# Current Configuration

Read the config file at `{{install_dir}}/.nori-config.json` and display the current Watchtower authentication status:
- Username: <value or "not configured">
- Organization URL: <value or "not configured">
- Password: <"configured" if present, otherwise "not configured">

**Important:** Do NOT display the actual password value to the user.


# Important Notes

- Watchtower credentials are stored in `{{install_dir}}/.nori-config.json`
- The password is stored in plain text in the config file - keep this file secure
- You can use `http://localhost:3000` for local development
- For production, use your organization's Watchtower URL (e.g., `https://api.tilework.tech`)
