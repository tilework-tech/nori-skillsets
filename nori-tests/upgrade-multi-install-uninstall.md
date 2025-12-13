# Upgrade, Multi-Installation, and Uninstall Integration Test

This test validates the complete lifecycle of nori-profiles installation, including:
- Upgrading from a previous npm version to a newly built version
- Profile switching functionality
- Multi-installation scenarios with nested directories
- Cursor-agent installation alongside claude-code
- Uninstall behavior with multiple installation locations
- Slash command functionality

---

## Step 1: Install Previous Version from npm

Install the latest stable version of nori-ai from npm.

```bash
npm install -g nori-ai
```

**Verify installation:**
```bash
which nori-ai
nori-ai --version
```

Expected output:
- `which nori-ai` should show a path like `/usr/local/bin/nori-ai` or `~/.npm-global/bin/nori-ai`
- `nori-ai --version` should show the version number (e.g., `19.0.0` or similar)

If installation fails, write to status file:
```json
{
  "status": "failure",
  "error": "Failed to install previous version from npm. Error: <error message>"
}
```

---

## Step 2: Run Installation with Previous Version

Install nori-ai for claude-code using the npm version.

```bash
nori-ai install --agent=claude-code --profile=senior-swe
```

**Verify installation succeeded:**
```bash
ls -la ~/.claude/
cat ~/.claude/settings.json
cat ~/.claude/CLAUDE.md | head -20
ls ~/.claude/skills/
```

Expected results:
- `~/.claude/` directory exists
- `~/.claude/settings.json` exists and contains valid JSON
- `~/.claude/CLAUDE.md` exists and contains the Nori managed block
- `~/.claude/skills/` directory exists with skills like `writing-plans`, `test-driven-development`, etc.

If any verification fails, write to status file:
```json
{
  "status": "failure",
  "error": "Previous version installation failed. Missing: <what's missing>"
}
```

---

## Step 3: Build New Version from Source

The nori-profiles code is already present in the current working directory. Build it from source.

```bash
pwd  # Should show the nori-profiles repository root
npm install
npm run build
```

**Verify build succeeded:**
```bash
ls -la build/
test -f build/src/cli/cli.js && echo "CLI built successfully" || echo "CLI build failed"
```

Expected results:
- `build/` directory exists
- `build/src/cli/cli.js` exists

If build fails, write to status file:
```json
{
  "status": "failure",
  "error": "Build failed. Error: <error message>"
}
```

---

## Step 4: Install New Version (Upgrade Flow)

Install the newly built version, which should trigger an upgrade flow.

```bash
node build/src/cli/cli.js install --agent=claude-code --profile=senior-swe
```

**Verify upgrade succeeded:**
```bash
cat ~/.claude/.nori-version
cat ~/.claude/.nori-config.json
ls ~/.claude/skills/
cat ~/.claude/CLAUDE.md | grep -A 5 "BEGIN NORI-AI MANAGED BLOCK"
```

Expected results:
- `~/.claude/.nori-version` exists and contains the new version number
- `~/.claude/.nori-config.json` contains `"agents": {"claude-code": {...}}`
- Skills directory is intact with expected skills
- CLAUDE.md has the managed block with updated content
- **Previous version files are removed** (no duplicates or old artifacts)

**Critical check - verify clean upgrade:**
```bash
# There should be no duplicate skills or old installation artifacts
find ~/.claude -name "*.bak" -o -name "*.old" | wc -l
```

This should return `0` (no backup files left behind).

If upgrade has issues, write to status file:
```json
{
  "status": "failure",
  "error": "Upgrade failed. Issue: <description of what went wrong>"
}
```

---

## Step 5: Create Subdirectory and Switch Profile to None

Create a subdirectory, navigate into it, and switch the claude-code profile to "none".

```bash
cd /tmp
mkdir test-project-1
cd test-project-1
```

**Switch profile to none:**
```bash
# Use the slash command to switch profile
echo "/nori-switch-profile none" | claude-code --dangerously-skip-permissions
```

**Verify profile switch:**
```bash
cat ~/.claude/CLAUDE.md
ls ~/.claude/skills/
cat ~/.claude/.nori-config.json
```

Expected results:
- `~/.claude/CLAUDE.md` should NOT contain the managed block (or it should be minimal/empty)
- `~/.claude/skills/` directory should be empty or not exist
- `~/.claude/.nori-config.json` should show `"profile": "none"`

If profile switch failed, write to status file:
```json
{
  "status": "failure",
  "error": "Profile switch to 'none' failed. Issue: <description>"
}
```

---

## Step 6: Create Alias for New CLI

Create an alias so we can use the newly built CLI as `nori-ai`. Get the current working directory first.

```bash
REPO_ROOT=$(pwd)
alias nori-ai="node ${REPO_ROOT}/build/src/cli/cli.js"
```

**Verify alias works:**
```bash
nori-ai --version
```

Expected output:
- Version should match the version in `package.json` in the current directory

If alias doesn't work, write to status file:
```json
{
  "status": "failure",
  "error": "Alias creation failed or nori-ai command doesn't work"
}
```

---

## Step 7: Create Nested Subdirectory and Install Cursor-Agent

Create another subdirectory (nested within the previous one) and install cursor-agent.

```bash
cd /tmp/test-project-1
mkdir nested-project
cd nested-project
pwd  # Should show /tmp/test-project-1/nested-project
```

**Install cursor-agent:**
```bash
nori-ai install --agent=cursor-agent --profile=senior-swe
```

**Verify warning about multiple install locations:**

The installation should warn that there's an existing Nori installation in a parent directory (`~/.claude/`).

Check the output for a warning message like:
- "Warning: Nori is already installed in a parent directory"
- "Existing installation found at: ~/.claude"
- Or similar messaging

If NO warning is shown, note this as a potential issue.

**Verify cursor-agent installation:**
```bash
# Check local installation (.nori directory in current subdirectory)
ls -la .nori/
cat .nori/.nori-config.json
cat .nori/.nori-version

# Check cursor directory in home
ls -la ~/.cursor/
cat ~/.cursor/.cursorrules
```

Expected results:
- `.nori/` directory exists in `/tmp/test-project-1/nested-project/`
- `.nori/.nori-config.json` shows `"agents": {"cursor-agent": {...}}`
- `.nori/.nori-version` shows the version
- `~/.cursor/.cursorrules` exists and contains cursor-agent configuration
- **Warning was displayed** about multiple installation locations

If cursor-agent installation failed, write to status file:
```json
{
  "status": "failure",
  "error": "Cursor-agent installation failed. Issue: <description>"
}
```

---

## Step 8: Verify .nori-config.json Structure

Check that the `.nori-config.json` file has the correct structure.

```bash
cat /tmp/test-project-1/nested-project/.nori/.nori-config.json
```

Expected structure:
```json
{
  "installDir": "/tmp/test-project-1/nested-project/.nori",
  "agents": {
    "cursor-agent": { "profile": { "baseProfile": "senior-swe" } }
  },
  ...
}
```

Verify:
- `installDir` points to the current directory's `.nori` folder
- `agents` object contains `"cursor-agent"` key
- Agent profile is `"senior-swe"`

If config structure is wrong, write to status file:
```json
{
  "status": "failure",
  "error": "Config structure incorrect. Config: <show actual config>"
}
```

---

## Step 9: Switch Cursor-Agent Profile to None

Switch the cursor-agent profile to "none".

```bash
cd /tmp/test-project-1/nested-project
nori-ai switch-profile --agent=cursor-agent --profile=none
```

**Verify profile switch:**
```bash
cat ~/.cursor/.cursorrules
cat /tmp/test-project-1/nested-project/.nori/.nori-config.json
```

Expected results:
- `~/.cursor/.cursorrules` should be minimal or empty (no profile-specific content)
- `.nori/.nori-config.json` should show `"profile": "none"`

If profile switch failed, write to status file:
```json
{
  "status": "failure",
  "error": "Cursor-agent profile switch to 'none' failed. Issue: <description>"
}
```

---

## Step 10: Run Uninstall and Verify Behavior

Run the uninstall command and verify it correctly detects multiple installation locations.

```bash
cd /tmp/test-project-1/nested-project
nori-ai uninstall
```

**Verify uninstall messages:**

The uninstaller should:
1. **Notify** that there are multiple install directories
2. **Indicate** it is using the current subdirectory (`.nori`)
3. **Specify** it is uninstalling `cursor-agent` (not claude-code)

Check the output for messages like:
- "Multiple Nori installations detected"
- "Using installation at: /tmp/test-project-1/nested-project/.nori"
- "Uninstalling cursor-agent"

**Verify uninstall completed:**
```bash
# Local .nori directory should be gone
test -d /tmp/test-project-1/nested-project/.nori && echo "ERROR: .nori still exists" || echo "OK: .nori removed"

# Cursor files should be cleaned up
test -f ~/.cursor/.cursorrules && echo "ERROR: .cursorrules still exists" || echo "OK: .cursorrules removed"

# Claude installation should still exist (not affected)
test -d ~/.claude && echo "OK: ~/.claude still exists" || echo "ERROR: ~/.claude was removed"
```

Expected results:
- `/tmp/test-project-1/nested-project/.nori` directory removed
- `~/.cursor/.cursorrules` removed
- `~/.claude/` directory still exists (uninstall only affected cursor-agent)

If uninstall behavior is wrong, write to status file:
```json
{
  "status": "failure",
  "error": "Uninstall failed. Issue: <description of what went wrong>"
}
```

---

## Step 11: Verify /nori-install-location Slash Command

Use the `/nori-install-location` slash command to verify it shows the single remaining installation.

```bash
cd /tmp
echo "/nori-install-location" | claude-code --dangerously-skip-permissions
```

**Expected output:**

The command should show only ONE installation location:
- `~/.claude` (the claude-code installation)

It should NOT show:
- The removed `/tmp/test-project-1/nested-project/.nori` location

If the slash command shows incorrect locations, write to status file:
```json
{
  "status": "failure",
  "error": "/nori-install-location shows incorrect data. Output: <actual output>"
}
```

---

## Step 12: Final Cleanup

Clean up the test environment.

```bash
cd /tmp
rm -rf test-project-1

# Optionally uninstall claude-code too
cd ~
nori-ai uninstall --agent=claude-code
```

**Verify complete cleanup:**
```bash
test -d ~/.claude && echo "WARNING: ~/.claude still exists" || echo "OK: ~/.claude removed"
test -d ~/.cursor && echo "WARNING: ~/.cursor still exists" || echo "OK: ~/.cursor removed"
```

---

## Success Criteria

If ALL of the following are true, write success to the status file:

1. ✅ Previous version installed successfully from npm
2. ✅ New version built successfully from source
3. ✅ Upgrade flow completed cleanly (old artifacts removed, new version installed)
4. ✅ Profile switch to "none" worked correctly
5. ✅ Cursor-agent installation succeeded in nested directory
6. ✅ Warning was shown about multiple installation locations
7. ✅ `.nori-config.json` structure is correct
8. ✅ Cursor-agent profile switch to "none" worked
9. ✅ Uninstall correctly identified multiple locations and uninstalled cursor-agent from the correct directory
10. ✅ `/nori-install-location` slash command shows accurate information

**Write success status:**
```bash
cat > /tmp/.nori-test-status.json << 'EOF'
{
  "status": "success"
}
EOF
```

---

## Failure Handling

If ANY step fails, immediately write a failure status with a descriptive error message:

```bash
cat > /tmp/.nori-test-status.json << 'EOF'
{
  "status": "failure",
  "error": "Step X failed: <specific description of what went wrong>"
}
EOF
```

Include in the error message:
- Which step failed
- What was expected
- What actually happened
- Any relevant command output or error messages

---

## Notes for Test Executor (Claude)

- Run each command sequentially
- Check the exit code of each command (`$?` in bash) - if non-zero, the command failed
- Capture stdout and stderr for debugging
- Be explicit about what you're verifying at each step
- If a verification fails, explain WHY it failed in the error message
- Clean up thoroughly even if tests fail
