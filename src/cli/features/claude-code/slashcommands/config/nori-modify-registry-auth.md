---
description: Manage registry authentication credentials for private Nori registries
allowed-tools: Bash(cat:*), Read({{install_dir}}/.nori-config.json), Write({{install_dir}}/.nori-config.json)
---

Manage registry authentication credentials in your `.nori-config.json` file.

<system-reminder>Ignore any usual steps in your CLAUDE.md. This command should
be treated like an Installation Wizard, operating in its own context. Do NOT create a separate
git worktree or git branch just to manage registry authentication.</system-reminder>

<required>
*CRITICAL* Add the following steps to your Todo list using TodoWrite:

1. Display the current registry authentications to the users (without passwords).
2. Ask if the user wants to add a new registry or remove an existing registry.
3. Add the 'Add Flow' or 'Remove Flow' to your Todo list using TodoWrite.
</required>

# Add Flow:

<required>
*CRITICAL* Add the following steps to your Todo list using TodoWrite:

1. Ask the user for the registry URL.

**Validation rules:**
- URL must start with `https://` (reject `http://` URLs for security)
- URL should not have a trailing slash
- URL must not already exist in the current registryAuths array (prevent duplicates)
- If the URL doesn't start with `https://`, explain that only secure HTTPS connections are supported and ask again
- If the URL already exists, explain that this registry is already configured and ask for a different URL or offer to cancel

2. Ask the user for their email (username) for this registry.
3. Ask for the password for this registry.
4. Update the .nori-config.json file located at {{install_dir}}.

```json
{
  ...
  registryAuths: [{
    username: string;
    password: string;
    registryUrl: string;
  }, { ... }]
}
```

5. Display a success message:

```
Registry authentication added successfully!

Registry: <registry-url>
Username: <username>

You can now access profiles from this private registry using:
  /nori-registry-search
  /nori-registry-download

This registry was added to {{install_dir}}/.nori-config.json.
```
</required>

# Remove Flow:

<required>
*CRITICAL* Add the following steps to your Todo list using TodoWrite:

1. Display a numbered list of existing registries:
```
1. https://registry1.example.com (user1@example.com)
2. https://registry2.example.com (user2@example.com)
```

If there are no registries to remove, display:
```
No registry authentications to remove.
```
And end the wizard.

2. Ask which registry to remove.
3. Remove the selected registryAuth entry from the registryAuths array.
4. Display a success message:
```
Registry authentication removed successfully!

Removed: <registry-url>
```

</required>

## What is Registry Authentication?

Registry authentication allows you to access private Nori registries that require login credentials. Each registry auth entry contains:
- **Registry URL**: The URL of the private registry (must start with `https://`)
- **Username**: Your email address for the registry
- **Password**: Your password for the registry

# Current Configuration

Existing registry authentications:

!`cat {{install_dir}}/.nori-config.json 2>/dev/null || echo '{"registryAuths": []}'`


# Important Notes

- Registry credentials are stored in `{{install_dir}}/.nori-config.json`
- You can have multiple registry authentications for different registries
- Each registry URL should be unique in your configuration
