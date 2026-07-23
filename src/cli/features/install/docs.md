# Noridoc: install

Path: @/src/cli/features/install

### Overview

The install orchestration: the end-to-end pipeline that initializes the Nori environment, resolves the active skillset, runs each agent's feature loaders, and displays completion banners. This is not a registered CLI command -- it is the shared engine that commands invoke when they need a full (re)install. It previously lived under `src/cli/commands/install/` and was moved into the features layer so commands can import it statically without module cycles.

### How it fits into the larger codebase

- Called statically by `switch-skillset` (silent reinstall after a switch), `config` (reinstall on installDir/agent changes), and `registry-install` (download-and-activate). The old dynamic `import()` calls that existed solely to dodge the switch -> install -> init module cycle are gone; the dependency direction is now commands -> features -> utils throughout.
- `initialize.ts` exports `ensureNoriInitialized`, the non-interactive init core. The `init` command (@/src/cli/commands/init/init.ts) delegates its non-interactive path to it; the install orchestration calls it directly with bulk marker creation disabled instead of invoking the init command, which is what broke the cycle.
- Delegates skillset installation to `installSkillset` from @/src/cli/features/agentOperations.ts and agent lookup to @/src/cli/features/agentRegistry.ts.
- The Git-backed installer calls the low-level non-interactive entry point once per configured agent with active-skillset persistence disabled, then owns the single config commit after every activation succeeds.
- Git and registry skillset installation, switch, init, config, clear, clear-current, factory-reset, unlink, external skill installation, skill-download, subagent-download, and direct config-update entry points serialize their complete mutation transactions through a filesystem lock in the user's Nori home. The boundary covers activation/config mutations, destructive cleanup, and commands that update live agent files; profile-authoring-only commands such as new, fork, and link remain outside it. Nested activation performed by one transaction is reentrant and retains the parent lock.
- Fires install-lifecycle analytics via @/src/cli/installTracking.ts and reads/writes config via @/src/cli/config.ts.
- `scripts/build.sh` chmods the built `install.js` at this location.

### Core Implementation

- `install.ts` exposes `main` and the lower-level `noninteractive` entry point (init via `ensureNoriInitialized`, resolve skillset, then `completeInstallation`). Both accept an optional `persistActiveSkillset` flag (default: persist). Persisting the global `activeSkillset` to `.nori-config.json` via `updateConfig` is gated on `persistActiveSkillset !== false`: transient `--install-dir` switches and staged Git activation therefore avoid clobbering global state, while the selected skillset is still threaded in-memory into `completeInstallation` so the correct files land in the target directory and downstream config loaders preserve the on-disk value.
- The low-level `noninteractive` entry point also owns silent-mode suppression. When requested, it preserves and restores the caller's prior logger state and temporarily suppresses direct console, stdout, and stderr writes around the entire installation, including failures.
- `installLock.ts` creates the Nori home when it is missing, prepares a unique candidate directory with its owner marker already present, then publishes that complete directory as the global lock. A live owner causes an independent operation to fail immediately. Only a recognized owner whose PID is dead is recoverable; age never makes a live owner stale, and empty or unrecognized lock state remains busy. Recovery and release unlink only the exact owner marker they observed, then remove the lock directory only when it is empty. Async-local ownership makes nested calls reentrant without weakening exclusion for unrelated work.
- `completeInstallation` writes `~/.nori-install-in-progress` immediately before running `installSkillset` and removes it in a `finally` boundary. The marker therefore represents only an active loader run and cannot remain after either success or failure. The per-agent `.nori-managed` marker is made durable before completion analytics and banners report success.
- `initialize.ts` (`ensureNoriInitialized`) creates `~/.nori/profiles/` and exposes independent controls for existing-config capture and installation markers. Direct init enables both. Install orchestration captures pre-existing agent configuration as a `"my-profile"` skillset when needed but disables bulk markers, then marks each agent only after its loaders succeed. Registry-download auto-init disables both controls, making it storage-only and unable to read, capture, or rewrite agent instructions.
- `installState.ts` (`hasExistingInstallation`) detects whether a Nori config file already exists; `registry-install` snapshots this before downloading so auto-init cannot change whether activation takes the first-install or existing-install branch.
- `asciiArt.ts` renders the welcome banner and seaweed bed. Display functions check `isSilentMode()` and return early when silent. Output uses raw `process.stdout.write()` rather than `@clack/prompts` because clack's `log.*` methods prepend bar symbols that would break ASCII art alignment.

### Things to Know

- `noninteractive` calls `process.exit(1)` when no skillset can be resolved (no `skillset` argument and no `activeSkillset` in config), so callers on fresh installs must pass `skillset` explicitly.
- The runtime `installDir` is overlaid on the loaded config (`{ ...config, installDir }`) for operational use but never persisted -- only `sks config` writes `installDir` to `.nori-config.json`.
- Manifest writing always happens inside `installSkillset`; there is no skip flag. Manifests are keyed per (agent, install dir) in @/src/cli/features/manifest.ts, so transient `--install-dir` overrides get their own manifests instead of being skipped.
- The agent defaults to `AgentRegistry.getInstance().getDefaultAgentName()` (i.e., `DEFAULT_AGENT_NAME` from @/src/cli/features/agentTable.ts) when no agent is specified.
- Silent mode is scoped to each invocation and restores both stream functions and the previous logger state, so nested command orchestration does not leak silence into later work.
- Registry- and Git-backed outer transactions always run their nested per-agent activations silently. Inner install success banners therefore cannot appear before the outer transaction has finished all agents and completed any permitted shared-state commit.
- Install locking is intentionally process-global rather than scoped by agent or destination: installation also mutates shared configuration and user-level agent files, so apparently distinct targets are not safe to activate concurrently.

Created and maintained by Nori.
