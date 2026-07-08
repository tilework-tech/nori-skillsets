# Noridoc: switch-skillset

Path: @/src/cli/commands/switch-skillset

### Overview

- Switches the active skillset by validating the target, detecting local changes, reinstalling configuration files, and persisting the new `activeSkillset` to config
- Supports both interactive (with the `switchSkillsetFlow` UI) and non-interactive modes, broadcasting the switch to all configured default agents

### How it fits into the larger codebase

- Registered as `switch-skillset` via `@/src/cli/commands/noriSkillsetsCommands.ts` with `wrapWithFraming`
- Resolves agents via `getDefaultAgents({ config, agentOverride: options.agent ?? null })`, where `options.agent` is the command-level `--agent` flag. This explicit `agentOverride` takes precedence over the global `--agent` override set by the CLI `preAction` hook (see @/src/cli/docs.md)
- Delegates lifecycle operations to `@/cli/features/agentOperations.js` (`switchSkillset`, `detectLocalChanges`, `captureExistingConfig`) -- it does not manipulate agent files directly
- Triggers a silent `installMain` from `@/src/cli/features/install/install.ts` after switching to regenerate all managed files under the new skillset (a static import; the old dynamic `import()` that dodged a command-module cycle is gone)
- Optionally triggers `registryDownloadMain` from `@/cli/commands/registry-download/registryDownload.js` to re-download the target skillset before switching (controlled by `config.redownloadOnSwitch`). The refetch is **pinned to the registry recorded in the skillset's `.nori-version` provenance** via the exported `resolveRedownloadSource` helper (which reads it through `readVersionInfo` from @/src/packaging/provenance.ts) — not a registry re-derived from the skillset's name; a skillset with no recorded registry (locally-created `personal/` bucket) is skipped
- The interactive flow is driven by `switchSkillsetFlow` from `@/cli/prompts/flows/switchSkillset.js`, which receives a `callbacks` object for all side-effectful operations
- Resolves install directory via `resolveInstallDir` from `@/utils/path.ts`; the resolved directory's provenance only gates config persistence, not manifest operations

### Core Implementation

**Callback-driven interactive flow**: `switchSkillsetAction` constructs a `callbacks` object and passes it to `switchSkillsetFlow`. The flow orchestrates the UI while callbacks handle all state mutations:

| Callback | Purpose |
|----------|---------|
| `onResolveAgents` | Returns the list of default agents with display names |
| `onPrepareSwitchInfo` | Detects local changes via manifest comparison for a given agent |
| `onCaptureConfig` | Captures unmanaged config as a named skillset before overwriting |
| `onExecuteSwitch` | Validates the target skillset, then runs `installMain` in silent mode |
| `onRedownload` | Re-downloads the skillset, pinned to the registry recorded in its `.nori-version` provenance (omitted when `redownloadOnSwitch` is disabled; a no-op when `resolveRedownloadSource` finds no recorded registry — the locally-created `personal/` bucket) |
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

**Config persistence**: `activeSkillset` is written to config via `updateConfig` after a successful switch, unless the install dir came from a CLI override (transient context). The transient-override guard (`resolved.source !== "cli"`) now also propagates into the silent reinstall: both `installMain(...)` call sites (the interactive `onExecuteSwitch` callback and the non-interactive loop) pass `persistActiveSkillset: resolved.source !== "cli"`. This closes a hole where the reinstall's own `updateConfig({ activeSkillset })` in @/src/cli/features/install/install.ts would clobber the global `activeSkillset` even though the switch command itself skipped persistence — a `--install-dir` switch now never mutates global `activeSkillset` end-to-end. `updateConfig` persists it as the canonical namespaced identity (see @/src/cli/docs.md), so a bare `foo` becomes `public/foo` / `personal/foo` on disk.

### Things to Know

- Local change detection always runs, including with `--install-dir`. `detectLocalChanges` (in @/src/cli/features/agentOperations.ts) compares only against the per-(agent, install dir) keyed manifest from @/src/cli/features/manifest.ts, with no legacy non-keyed fallback. Only the keyed manifest proves Nori installed to THIS exact path; absent one, there is no baseline and it returns null. This means a directory carrying only a committed or git-checked-out `.nori-managed` marker (e.g. a `.claude`/`.codex` marker committed to a repo and checked out into a fresh `git worktree add`) reports no local changes, so non-interactive per-worktree switching is no longer wrongly blocked with "Local changes detected ... use --force". The legacy fallback is still used elsewhere (uninstall/cleanup); only change-detection dropped it. The former `skipManifest` flag is gone.
- The non-interactive flow checks local changes on only the first default agent. The interactive flow checks per-agent via `onPrepareSwitchInfo`.
- `onExecuteSwitch` temporarily enables silent mode during the switch+install to suppress loader output, restoring the previous mode afterward.
- **Re-download is pinned to recorded provenance, not the name.** The exported `resolveRedownloadSource({ name })` resolves the target dir, reads its `.nori-version` via `readVersionInfo`, and returns the recorded `registryUrl` (or null when none is recorded). This single helper is both the gate (whether to refetch) and the source (from where): `onRedownload` skips when it returns null, otherwise calls `registryDownloadMain({ packageSpec, registryUrl })` with that pinned URL. Deriving the registry from the name instead was not injective and drifted with `config.defaultOrg`, so it could refetch from the wrong host; passing an explicit `registryUrl` also makes `registryDownloadMain` parse the spec with `defaultOrg: null`, neutralizing that drift for the on-disk target directory. Locally-created `personal/` skillsets have no sidecar and are skipped.
- CLI-argument bare names are resolved via `resolveUserSkillsetRef({ name, defaultOrg, nameWasProvided, warn: !nonInteractive })`, so a configured `defaultOrg` wins over personal/public buckets, while explicit names like `public/foo` stay exact. Prompted selections are treated as exact installed identities. `switch --non-interactive` (automated fleet provisioning) suppresses the bare-name deprecation nudge while interactive switches still surface it once per process.

Created and maintained by Nori.
