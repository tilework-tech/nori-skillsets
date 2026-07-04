# Noridoc: install

Path: @/src/cli/features/install

### Overview

The install orchestration: the end-to-end pipeline that initializes the Nori environment, resolves the active skillset, runs each agent's feature loaders, and displays completion banners. This is not a registered CLI command -- it is the shared engine that commands invoke when they need a full (re)install. It previously lived under `src/cli/commands/install/` and was moved into the features layer so commands can import it statically without module cycles.

### How it fits into the larger codebase

- Called statically by `switch-skillset` (silent reinstall after a switch), `config` (reinstall on installDir/agent changes), and `registry-install` (download-and-activate). The old dynamic `import()` calls that existed solely to dodge the switch -> install -> init module cycle are gone; the dependency direction is now commands -> features -> utils throughout.
- `initialize.ts` exports `ensureNoriInitialized`, the non-interactive init core. The `init` command (@/src/cli/commands/init/init.ts) delegates its non-interactive path to it; the install orchestration calls it directly instead of invoking the init command, which is what broke the cycle.
- Delegates skillset installation to `installSkillset` from @/src/cli/features/agentOperations.ts and agent lookup to @/src/cli/features/agentRegistry.ts.
- Fires install-lifecycle analytics via @/src/cli/installTracking.ts and reads/writes config via @/src/cli/config.ts.
- `scripts/build.sh` chmods the built `install.js` at this location.

### Core Implementation

- `install.ts` exposes `main` (wraps `noninteractive` with optional silent-mode output suppression) and `noninteractive` (init via `ensureNoriInitialized`, resolve skillset, persist `activeSkillset`, then `completeInstallation`). `completeInstallation` writes a progress marker at `~/.nori-install-in-progress`, runs `installSkillset` for the agent, sends started/completed analytics events, and shows banners.
- `initialize.ts` (`ensureNoriInitialized`) creates `~/.nori/profiles/`, captures pre-existing agent configuration as a `"my-profile"` skillset when no config exists yet, persists `activeSkillset`, and writes `.nori-managed` markers (via `markInstall`) for every default agent. The marker's skillset name resolves via `capturedSkillsetName ?? skillset ?? existingConfig?.activeSkillset ?? null`, so callers like `nori switch` can thread the target skillset through.
- `installState.ts` (`hasExistingInstallation`) detects whether a Nori config file already exists; `registry-install` snapshots this before downloading to decide whether to show first-install banners.
- `asciiArt.ts` renders the welcome banner and seaweed bed. Display functions check `isSilentMode()` and return early when silent. Output uses raw `process.stdout.write()` rather than `@clack/prompts` because clack's `log.*` methods prepend bar symbols that would break ASCII art alignment.

### Things to Know

- `noninteractive` calls `process.exit(1)` when no skillset can be resolved (no `skillset` argument and no `activeSkillset` in config), so callers on fresh installs must pass `skillset` explicitly.
- The runtime `installDir` is overlaid on the loaded config (`{ ...config, installDir }`) for operational use but never persisted -- only `sks config` writes `installDir` to `.nori-config.json`.
- `skipManifest` is threaded through `main` -> `noninteractive` -> `completeInstallation` -> `installSkillset`; commands set it when the install dir came from a transient `--install-dir` override (see @/src/cli/commands/docs.md).
- The agent defaults to `AgentRegistry.getInstance().getDefaultAgentName()` (i.e., `DEFAULT_AGENT_NAME` from @/src/cli/features/agentTable.ts) when no agent is specified.

Created and maintained by Nori.
