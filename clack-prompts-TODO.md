# @clack/prompts Migration TODO

Remaining tasks for completing the migration to @clack/prompts.

See `src/cli/prompts/flows/clack-prompts-usage.md` for patterns and conventions.

---

## Interactive Command Migration

Commands with user prompts (promptUser, promptYesNo, confirmations) that need
flow-based migration for consistent UX.

### High Priority (uses legacy promptUser/promptYesNo)

- [ ] `login/login.ts` - Email/password prompts, headless confirmation
  - Uses: `promptUser` (email, password, token), `promptYesNo` (headless confirm)
  - Flow exists: `loginFlow` - needs routing wired up in command
  - Complexity: High (multiple auth paths: SSO, email/password, headless)

- [ ] `switch-profile/profiles.ts` - Agent selection, change confirmation
  - Uses: `promptUser` (agent selection, proceed confirmation, profile name)
  - Flow exists: `switchSkillsetFlow` - partially routed (experimentalUi path)
  - Complexity: Medium (legacy path still uses promptUser)

- [ ] `init/init.ts` - Warning confirmation
  - Uses: `promptUser` (type "yes" to confirm)
  - Flow exists: `initFlow` - partially routed (experimentalUi path)
  - Complexity: Low (single confirmation)

- [ ] `install/existingConfigCapture.ts` - Profile name input
  - Uses: `promptUser` (profile name)
  - Note: initFlow handles this in experimentalUi path
  - Complexity: Low (legacy path only)

- [ ] `watch/watch.ts` - Auth URL input
  - Uses: `promptUser` (organization URL)
  - Complexity: Low (single text prompt)

### Medium Priority (uses clack wrappers but legacy output)

- [ ] `factory-reset/factoryReset.ts` + `claude-code/factoryReset.ts`
  - Uses: `promptText` (type "confirm")
  - Issue: Still uses legacy `warn`, `info`, `newline` for output
  - Needs: Convert to flow with `note()`, `log.warn()`, `spinner()`

---

## Noninteractive Output Migration

Commands without user prompts but with legacy output patterns (info/warn/error/
success/newline) that should be migrated to clack's output primitives for
consistent visual style.

### Output Commands (display-focused)

- [ ] `list-skillsets/listSkillsets.ts`
  - Current: `error()` for failures
  - Needs: `log.error()`, consider `note()` for skillset list display

- [ ] `install-location/installLocation.ts`
  - Current: `info()`, `success()`, `error()` scattered throughout
  - Needs: `note()` for installation info, `log.*` for messages

- [ ] `dir/dir.ts`
  - Current: `info()`, `success()`
  - Needs: `note()` or `log.info()` for directory path

- [ ] `edit-skillset/editSkillset.ts`
  - Current: `info()`, `success()`, `error()`
  - Needs: `log.*` and `note()` for skillset contents

### Download/Install Commands

- [ ] `registry-download/registryDownload.ts`
  - Current: Heavy use of `info()`, `success()`, `error()` (30+ calls)
  - Needs: `spinner()` for download progress, `note()` for summary, `log.*`
  - Complexity: High (many output points)

- [ ] `skill-download/skillDownload.ts`
  - Current: Similar pattern to registry-download (25+ calls)
  - Needs: `spinner()`, `note()`, `log.*`
  - Complexity: High

- [ ] `registry-install/registryInstall.ts`
  - Current: `success()`, `info()`, `warn()`, `error()`
  - Needs: `spinner()` for install, `log.*` for messages

- [ ] `external/external.ts` (GitHub skill install)
  - Current: `info()`, `success()`, `error()`, `warn()` (20+ calls)
  - Needs: `spinner()` for clone/install, `note()` for summary, `log.*`
  - Complexity: Medium-High

### Search/Query Commands

- [ ] `registry-search/registrySearch.ts`
  - Current: `info()`, `error()` for results/errors
  - Needs: `note()` for search results, `log.error()` for failures

### Create/Modify Commands

- [ ] `fork-skillset/forkSkillset.ts`
  - Current: `success()`, `info()`, `error()`
  - Needs: `spinner()` for copy operation, `note()` for result

- [ ] `new-skillset/newSkillset.ts`
  - Current: `success()`, `info()`, `error()`
  - Needs: `spinner()` for creation, `note()` for result

### Auth Commands

- [ ] `logout/logout.ts`
  - Current: `info()`, `success()`
  - Needs: `log.info()`, `log.success()` (simple, low priority)

### Utility Commands

- [ ] `completion/completion.ts`
  - Current: `error()` only
  - Needs: `log.error()` (minimal change)

---

## Cleanup

- [ ] Delete `src/cli/prompt.ts` after all interactive commands migrated
  - Currently used by: login.ts, watch.ts, init.ts, switch-profile/profiles.ts,
    existingConfigCapture.ts
  - Update test mocks that reference it

- [ ] Audit `src/cli/logger.ts` usage after noninteractive migration
  - Functions to replace: `info()`, `warn()`, `error()`, `success()`, `newline()`
  - Keep: Color helpers (`bold`, `brightCyan`, `green`, `red`, etc.)

---

## Testing

- [ ] Cross-platform terminal testing (macOS + Linux)
- [ ] Verify non-interactive mode works for all migrated commands
- [ ] Test spinner behavior in CI environments (no TTY)
