# Noridoc: install

Path: @/src/cli/features/install

### Overview

The install orchestration: the end-to-end pipeline that initializes the Nori environment, resolves the active skillset, runs each agent's feature loaders, and displays completion banners. This is not a registered CLI command -- it is the shared engine that commands invoke when they need a full (re)install. It previously lived under `src/cli/commands/install/` and was moved into the features layer so commands can import it statically without module cycles.

### How it fits into the larger codebase

- Called statically by `switch-skillset` (silent reinstall after a switch), `config` (reinstall on installDir/agent changes), and `registry-install` (download-and-activate). The old dynamic `import()` calls that existed solely to dodge the switch -> install -> init module cycle are gone; the dependency direction is now commands -> features -> utils throughout.
- `initialize.ts` exports `ensureNoriInitialized`, the non-interactive init core. The `init` command (@/src/cli/commands/init/init.ts) delegates its non-interactive path to it; the install orchestration calls it directly with bulk marker creation disabled instead of invoking the init command, which is what broke the cycle.
- Delegates skillset installation to `installSkillset` from @/src/cli/features/agentOperations.ts and agent lookup to @/src/cli/features/agentRegistry.ts.
- The Git-backed installer and registry/switch orchestration call the low-level, throwing `noninteractive` entry point once per configured agent with active-skillset persistence disabled, then own the single config commit after every activation succeeds. They bypass the CLI-facing `main` wrapper, which reports a failure and exits the process.
- Git and registry skillset installation, switch, init, config, clear, clear-current, factory-reset, unlink, external skill installation, skill-download, subagent-download, and direct config-update entry points serialize their complete mutation sequences through a filesystem lock in the user's Nori home. The boundary covers activation/config mutations, destructive cleanup, and commands that update live agent files; profile-authoring-only commands such as new, fork, and link remain outside it. Nested activation is reentrant and retains the parent lock. Read-only skill/subagent version listing bypasses the lock; registry version listing bypasses it only after config exists, because first use creates profile storage.
- Fires install-lifecycle analytics via @/src/cli/installTracking.ts and reads/writes config via @/src/cli/config.ts.
- `scripts/build.sh` chmods the built `install.js` at this location.

### Core Implementation

- `install.ts` exposes `main` and the lower-level, throwing `noninteractive` entry point (init via `ensureNoriInitialized`, resolve skillset, then `completeInstallation`). Both accept an optional `persistActiveSkillset` flag (default: persist). Persisting the global `activeSkillset` to `.nori-config.json` via `updateConfig` is gated on `persistActiveSkillset !== false`: transient `--install-dir` switches and staged multi-agent activation therefore avoid clobbering global state, while the selected skillset is still threaded in-memory into `completeInstallation` so the correct files land in the target directory and downstream config loaders preserve the on-disk value. The public `main` wrapper alone converts a thrown failure into logged output plus `process.exit(1)`.
- The low-level `noninteractive` entry point also owns silent-mode suppression. When requested, it preserves and restores the caller's prior logger state and temporarily suppresses direct console, stdout, and stderr writes around the entire installation, including failures.
- `installLock.ts` creates the Nori home when it is missing, prepares a unique candidate directory with its owner marker already present, then publishes that complete directory as the global lock. A live owner causes an independent operation to fail immediately. Empty lock directories and recognized owners whose processes are gone are recoverable. On Linux, new owner markers record the kernel boot ID plus process start ticks so a live PID reused by a different process is also recoverable; when that identity cannot be read, PID liveness remains the conservative fallback. Malformed nonempty lock state remains busy. Recovery and release unlink only the exact owner marker they observed, then remove the lock directory only when it is empty. Async-local ownership makes nested calls reentrant without weakening exclusion for unrelated work.
- `completeInstallation` writes `~/.nori-install-in-progress` immediately before running `installSkillset` and removes it in a `finally` boundary. The marker therefore represents only an active loader run and cannot remain after either success or failure. The per-agent `.nori-managed` marker is made durable before completion analytics and banners report success.
- `initialize.ts` (`ensureNoriInitialized`) creates `~/.nori/profiles/` and exposes independent controls for existing-config capture and installation markers. Direct init enables both. Install orchestration captures pre-existing agent configuration as a `"my-profile"` skillset when needed but disables bulk markers, then marks each agent only after its loaders succeed. The init command's `storageOnly` path, used by registry download before config exists, creates only the profiles directory and returns without config or agent inspection. Leaving config absent preserves normal first-install capture for later activation.
- `installState.ts` (`hasExistingInstallation`) detects whether a Nori config file already exists; `registry-install` snapshots this before downloading to choose its activation branch. Storage-only registry auto-init does not itself change that state.
- `asciiArt.ts` renders the welcome banner and seaweed bed. Display functions check `isSilentMode()` and return early when silent. Output uses raw `process.stdout.write()` rather than `@clack/prompts` because clack's `log.*` methods prepend bar symbols that would break ASCII art alignment.

### Things to Know

- `noninteractive` throws when initialization or skillset resolution fails, so nested registry/switch commands can return structured failures without terminating the process. Callers on fresh installs must pass `skillset` explicitly when no `activeSkillset` exists. The CLI-facing `main` wrapper retains exit-on-failure behavior.
- The runtime `installDir` is overlaid on the loaded config (`{ ...config, installDir }`) for operational use but never persisted -- only `sks config` writes `installDir` to `.nori-config.json`.
- Manifest writing always happens inside `installSkillset`; there is no skip flag. Manifests are keyed per (agent, install dir) in @/src/cli/features/manifest.ts, so transient `--install-dir` overrides get their own manifests instead of being skipped.
- The agent defaults to `AgentRegistry.getInstance().getDefaultAgentName()` (i.e., `DEFAULT_AGENT_NAME` from @/src/cli/features/agentTable.ts) when no agent is specified.
- Silent mode is scoped to each invocation and restores both stream functions and the previous logger state, so nested command orchestration does not leak silence into later work.
- Registry- and Git-backed outer operations always run their nested per-agent activations silently. Inner install success banners therefore cannot appear before the outer operation has finished all agents and completed any permitted shared-state commit.
- Multi-agent activation stages only the shared config commit. If a later agent fails, earlier agent files and markers may remain applied; the lock prevents interleaving but provides no rollback.
- Install locking is intentionally process-global rather than scoped by agent or destination: installation also mutates shared configuration and user-level agent files, so apparently distinct targets are not safe to activate concurrently.

Created and maintained by Nori.
