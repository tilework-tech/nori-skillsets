---
name: Release Notes Update
description: Step-by-step instructions for updating release-notes.txt before npm publish
---

<required>
*CRITICAL* Follow these steps exactly in order:

0. Create a new branch for release note updates, with the date in the branch.
```bash
git checkout -b amol/release-notes-MM-DD-YYYY
```

1. Find the last published version from npm.

Run the following command to get the currently published version:
```bash
npm view nori-skillsets version
```

This returns the version string (e.g., "19.1.1").

2. Find the commit where that version was first set.

Using the version from step 1, find the **first** commit where it was added to package.json:
```bash
git log -S '"version": "<version>"' --oneline --format="%H" --reverse -- package.json | head -1
```

The `-S` flag (pickaxe search) finds commits where this exact version string was added or removed from package.json. The `--reverse` flag orders results oldest-first, and `head -1` gets the first occurrence.

**Why `--reverse | head -1`?** Without these flags, `-S` returns the *most recent* commit that touched the version string. If the version was set, then more commits were added, then another bump commit touched package.json (even if it kept the same version), the pickaxe would return the later bump commit—missing all the commits in between.

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

<system-reminder> The description should actually explain what changed. If the commit title is too vague, you must go deeper and look at the full commit text or the code changes themselves. </system-reminder>
<system-reminder> You do NOT have to include every single commit in the release notes. Focus on the big changes that impact user experience, do not include minor commits for things like docs. </system-reminder>

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

The last published version is retrieved from the npm registry using `npm view nori-skillsets version`. The commit where that version was **first** set is found using git's pickaxe search (`-S` flag) with `--reverse | head -1` to get the earliest occurrence. This is important because subsequent commits may touch package.json without changing the version, and we need all commits since the version was originally set.

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
