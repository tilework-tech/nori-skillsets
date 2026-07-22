# Noridoc: install

Path: @/src/cli/features/install

### Overview

The install orchestration: the end-to-end pipeline that initializes the Nori environment, resolves the active skillset, runs each agent's feature loaders, and displays completion banners. This is not a registered CLI command -- it is the shared engine that commands invoke when they need a full (re)install. It previously lived under `src/cli/commands/install/` and was moved into the features layer so commands can import it statically without module cycles.

### How it fits into the larger codebase

- Called statically by `switch-skillset` (silent reinstall after a switch), `config` (reinstall on installDir/agent changes), and `registry-install` (download-and-activate). The old dynamic `import()` calls that existed solely to dodge the switch -> install -> init module cycle are gone; the dependency direction is now commands -> features -> utils throughout.
- `initialize.ts` exports `ensureNoriInitialized`, the non-interactive init core. The `init` command (@/src/cli/commands/init/init.ts) delegates its non-interactive path to it; the install orchestration calls it directly with bulk marker creation disabled instead of invoking the init command, which is what broke the cycle.
- Delegates skillset installation to `installSkillset` from @/src/cli/features/agentOperations.ts and agent lookup to @/src/cli/features/agentRegistry.ts.
- The Git-backed installer calls the low-level non-interactive entry point once per configured agent with active-skillset persistence disabled, then owns the single config commit after every activation succeeds.
- Fires install-lifecycle analytics via @/src/cli/installTracking.ts and reads/writes config via @/src/cli/config.ts.
- `scripts/build.sh` chmods the built `install.js` at this location.

### Core Implementation

- `install.ts` exposes `main` and the lower-level `noninteractive` entry point (init via `ensureNoriInitialized`, resolve skillset, then `completeInstallation`). Both accept an optional `persistActiveSkillset` flag (default: persist). Persisting the global `activeSkillset` to `.nori-config.json` via `updateConfig` is gated on `persistActiveSkillset !== false`: transient `--install-dir` switches and staged Git activation therefore avoid clobbering global state, while the selected skillset is still threaded in-memory into `completeInstallation` so the correct files land in the target directory and downstream config loaders preserve the on-disk value.
- The low-level `noninteractive` entry point also owns silent-mode suppression. When requested, it preserves and restores the caller's prior logger state and temporarily suppresses direct console, stdout, and stderr writes around the entire installation, including failures.
- `completeInstallation` writes `~/.nori-install-in-progress` immediately before running `installSkillset` and removes it in a `finally` boundary. The marker therefore represents only an active loader run and cannot remain after either success or failure; completion analytics and banners run only after successful installation.
- `initialize.ts` (`ensureNoriInitialized`) creates `~/.nori/profiles/`, captures pre-existing agent configuration as a `"my-profile"` skillset when no config exists yet, and persists `activeSkillset`. Direct init retains the existing behavior of writing `.nori-managed` markers for every default agent, but installation disables that bulk step. After each agent's loaders succeed, the install orchestration writes only that agent's marker, so an agent that failed activation is never reported as installed.
- `installState.ts` (`hasExistingInstallation`) detects whether a Nori config file already exists; `registry-install` snapshots this before downloading to decide whether to show first-install banners.
- `asciiArt.ts` renders the welcome banner and seaweed bed. Display functions check `isSilentMode()` and return early when silent. Output uses raw `process.stdout.write()` rather than `@clack/prompts` because clack's `log.*` methods prepend bar symbols that would break ASCII art alignment.

### Things to Know

- `noninteractive` calls `process.exit(1)` when no skillset can be resolved (no `skillset` argument and no `activeSkillset` in config), so callers on fresh installs must pass `skillset` explicitly.
- The runtime `installDir` is overlaid on the loaded config (`{ ...config, installDir }`) for operational use but never persisted -- only `sks config` writes `installDir` to `.nori-config.json`.
- Manifest writing always happens inside `installSkillset`; there is no skip flag. Manifests are keyed per (agent, install dir) in @/src/cli/features/manifest.ts, so transient `--install-dir` overrides get their own manifests instead of being skipped.
- The agent defaults to `AgentRegistry.getInstance().getDefaultAgentName()` (i.e., `DEFAULT_AGENT_NAME` from @/src/cli/features/agentTable.ts) when no agent is specified.
- Silent mode is scoped to each invocation and restores both stream functions and the previous logger state, so nested command orchestration does not leak silence into later work.

Created and maintained by Nori.
