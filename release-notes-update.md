---
name: Release Notes Update
description: Step-by-step instructions for updating release-notes.txt before npm publish
---

<required>
*CRITICAL* Follow these steps exactly in order:

1. Find the last published version from npm.

Run the following command to get the currently published version:
```bash
npm view nori-ai version
```

This returns the version string (e.g., "19.1.1").

2. Find the commit where that version was set.

Using the version from step 1, find when it was added to package.json:
```bash
git log -S '"version": "<version>"' --oneline -1 --format="%H" -- package.json
```

The `-S` flag (pickaxe search) finds the commit where this exact version string was added to package.json.

3. Get all commits since the last version.

Using the commit hash from step 2, run:
```bash
git log --oneline <commit_hash>..HEAD
```

If there are no commits since the last version (empty output), skip to step 7.

4. Read the current release-notes.txt file.

Read the existing release notes to understand the format and append new notes.

5. Categorize the commits and draft release notes.

Group commits into categories:
- **Features**: Commits starting with "feat:" or containing "Add", "Implement"
- **Fixes**: Commits starting with "fix:" or containing "Fix", "Resolve"
- **Documentation**: Commits starting with "docs:" or containing documentation changes
- **Other**: Any remaining commits

Format the new release notes section as:
```
## vX.X.X (YYYY-MM-DD)

### Features
- Description of feature (commit hash)

### Fixes
- Description of fix (commit hash)

### Other
- Description of change (commit hash)
```

Use the version from package.json for the version number.
Use today's date for the release date.

6. Update release-notes.txt with the new section.

Prepend the new release notes section to the top of release-notes.txt, below the header.

7. Stage the updated release-notes.txt file.

Run:
```bash
git add release-notes.txt
```

This ensures the release notes are included in the publish commit.

</required>

# Additional Guidelines

## Version Detection

The last published version is retrieved from the npm registry using `npm view nori-ai version`. The commit where that version was set is found using git's pickaxe search (`-S` flag), which locates when the exact version string was added to package.json.

## Empty Releases

If there are no commits since the last version, the release notes should not be updated. This can happen if you're re-publishing the same version.

## Commit Message Conventions

This project follows conventional commits loosely:
- `feat:` - New features
- `fix:` - Bug fixes
- `docs:` - Documentation changes
- `bump` - Version bumps (ignore these in release notes)

## Error Handling

If git commands fail or produce unexpected output, report the error and stop. Do not generate placeholder or fake release notes.
