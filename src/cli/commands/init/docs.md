# Noridoc: init

Path: @/src/cli/commands/init

### Overview

The init command performs first-time setup of the Nori environment. Direct init creates the config file (`.nori-config.json`), the skillsets directory (`~/.nori/profiles/`), and optionally captures existing agent configuration as a named skillset. Direct init operations are broadcast to all configured default agents; the internal storage-only mode creates only the profiles directory.

### How it fits into the larger codebase

This command is the entry point for new installations and is also called implicitly by the `registry-download` command when no config exists. It interacts with `@/cli/config.js` for loading/saving the global config, `@/cli/features/agentRegistry.js` for agent-specific detection and installation marking, `@/norijson/skillset.js` for shared Nori directory locations, and `@/cli/prompts/flows/init.js` for the interactive setup wizard.

### Core Implementation

`initMain` has three code paths: interactive (default), non-interactive (`--nonInteractive`), and the internal `storageOnly` mode used by registry download. Interactive and non-interactive init create `~/.nori/profiles/` and save config. The interactive path delegates to `initFlow` with callbacks for ancestor checking, existing config detection, config capture, and final initialization. The non-interactive path delegates to `ensureNoriInitialized` from @/src/cli/features/install/initialize.ts -- the shared non-interactive init core, which the install orchestration in @/src/cli/features/install/install.ts also calls directly (instead of invoking this command, which previously created a module cycle). Both paths honor `captureExisting` and `markInstalled`, so callers can independently choose whether initialization may import agent instructions and whether it may claim activation. `storageOnly` creates only the profiles directory and returns without creating config or inspecting agent state.

The existing-config detection flow checks whether the first default agent (resolved from `AgentRegistry`) already has configuration at the install directory. If pre-existing config is found and no Nori config exists yet, it offers to capture that config as a skillset named `"my-profile"`.

**Multi-agent broadcasting:** When capturing existing config or completing direct initialization, the command loops over all default agents (via `getDefaultAgents()`, which automatically incorporates the global `--agent` flag override set by the CLI `preAction` hook -- see @/src/cli/docs.md). Capture and direct-init marker operations therefore remain consistent across multi-agent setups.

**Initialization modes:** Direct init keeps capture and marker creation enabled. Install orchestration keeps capture enabled so pre-existing agent configuration can be preserved, but disables bulk marker creation and writes each agent's `.nori-managed` marker only after that agent's loaders succeed. Registry-download auto-init passes `storageOnly: true`; it creates profile storage but no config and never reads, captures, or rewrites existing agent instructions. Because it leaves config absent, a later activation still runs the normal first-install capture path.

### Things to Know

Config is persisted via `updateConfig()` from @/src/cli/config.ts, which automatically preserves all existing fields (auth credentials, autoupdate preference, transcript destination) when updating. Except in `storageOnly` mode, `initMain` only persists `activeSkillset` to config -- it does not persist `installDir`, even when an `--install-dir` override is provided. The CLI version is intentionally not written to config; the running binary itself is the source of truth via `getCurrentPackageVersion()` in @/src/cli/version.ts. The `--install-dir` flag is used at runtime to determine where to operate but is not written to `.nori-config.json`; only `sks config` persists `installDir`. The `skipWarning` parameter suppresses the skillset persistence warning during auto-init from download flows, where the warning would be confusing. Detection (`detectExistingConfig`, `isInstalledAtDir`) still uses only the first agent since it checks whether *any* agent is set up. Direct init capture and marker operations broadcast to all agents; install-time markers are committed per agent after successful activation. Mutating init modes hold the reentrant global mutation lock.

Created and maintained by Nori.
