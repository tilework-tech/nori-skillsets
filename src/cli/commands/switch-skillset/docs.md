# Noridoc: switch-skillset

Path: @/src/cli/commands/switch-skillset

### Overview

- Switches the active skillset by validating the target, detecting local changes, reinstalling configuration files, and persisting the new `activeSkillset` to config
- Supports both interactive (with the `switchSkillsetFlow` UI) and non-interactive modes, broadcasting the switch to all configured default agents

### How it fits into the larger codebase

- Registered as `switch-skillset` via `@/src/cli/commands/noriSkillsetsCommands.ts` with `wrapWithFraming`
- Delegates lifecycle operations to `@/cli/features/agentOperations.js` (`switchSkillset`, `detectLocalChanges`, `captureExistingConfig`) -- it does not manipulate agent files directly
- Triggers a silent `installMain` from `@/cli/commands/install/install.js` after switching to regenerate all managed files under the new skillset
- Optionally triggers `registryDownloadMain` from `@/cli/commands/registry-download/registryDownload.js` to re-download the target skillset before switching (controlled by `config.redownloadOnSwitch`)
- The interactive flow is driven by `switchSkillsetFlow` from `@/cli/prompts/flows/switchSkillset.js`, which receives a `callbacks` object for all side-effectful operations
- Resolves install directory via `resolveInstallDir` from `@/utils/path.ts`, and when the directory comes from a CLI override (`--install-dir`), manifest operations are skipped to avoid false positives

### Core Implementation

**Callback-driven interactive flow**: `switchSkillsetAction` constructs a `callbacks` object and passes it to `switchSkillsetFlow`. The flow orchestrates the UI while callbacks handle all state mutations:

| Callback | Purpose |
|----------|---------|
| `onResolveAgents` | Returns the list of default agents with display names |
| `onPrepareSwitchInfo` | Detects local changes via manifest comparison for a given agent |
| `onCaptureConfig` | Captures unmanaged config as a named skillset before overwriting |
| `onExecuteSwitch` | Validates the target skillset, then runs `installMain` in silent mode |
| `onRedownload` | Re-downloads the skillset from the registry (omitted when `redownloadOnSwitch` is disabled) |
| `onReadFileDiff` | Reads the original source and current installed content for a managed file, used by the flow to display diffs of local changes |

**`onReadFileDiff` path mapping**: The installed agent directory uses different path conventions than the skillset source. This callback maps between them:

```
Installed (agent dir)          -->  Source (skillset dir)
skills/foo/SKILL.md            -->  skills/foo/SKILL.md          (identity)
commands/bar.md                -->  slashcommands/bar.md         (rename)
agents/my-agent.md             -->  subagents/my-agent.md        (flat file, checked first)
agents/my-agent.md             -->  subagents/my-agent/SUBAGENT.md  (directory-based, fallback)
```

For subagents, the flat file path is checked first via `fs.access`. If it does not exist, the directory-based path (`subagents/<name>/SUBAGENT.md`) is tried. If neither exists, `null` is returned. Template substitution is applied to `.md` files to match the install-time transformation.

**Non-interactive flow**: Checks for local changes on the first default agent. If changes exist and `--force` is not set, it throws. Otherwise, it iterates all default agents, calling `switchSkillsetOp` then `installMain` for each.

**Config persistence**: `activeSkillset` is written to config via `updateConfig` after a successful switch, unless the install dir came from a CLI override (transient context).

### Things to Know

- The `skipManifest` flag is derived from `resolved.source === "cli"`. When a user passes `--install-dir`, the manifest is stored globally per-agent and would produce false positives against a transient override directory, so manifest operations (local change detection, manifest writing during install) are skipped entirely.
- The non-interactive flow checks local changes on only the first default agent. The interactive flow checks per-agent via `onPrepareSwitchInfo`.
- `onExecuteSwitch` temporarily enables silent mode during the switch+install to suppress loader output, restoring the previous mode afterward.

Created and maintained by Nori.
