# Noridoc: init

Path: @/src/cli/commands/init

### Overview

The init command performs first-time setup of the Nori environment. It creates the config file (`.nori-config.json`), the skillsets directory (`~/.nori/profiles/`), and optionally captures an existing Claude Code configuration as a named skillset. All operations are broadcast to all configured default agents.

### How it fits into the larger codebase

This command is the entry point for new installations and is also called implicitly by the `registry-download` command when no config exists. It interacts with `@/cli/config.js` for loading/saving the global config, `@/cli/features/agentRegistry.js` for agent-specific detection and installation marking, `@/norijson/skillset.js` for shared Nori directory locations, and `@/cli/prompts/flows/init.js` for the interactive setup wizard.

### Core Implementation

`initMain` has two code paths: interactive (default) and non-interactive (`--nonInteractive`). Both paths create the `~/.nori/profiles/` directory and save a config file. The interactive path delegates to `initFlow` with callbacks for ancestor checking, existing config detection, config capture, and final initialization. The non-interactive path performs the same steps inline.

The existing-config detection flow checks whether the first default agent (resolved from `AgentRegistry`) already has configuration at the install directory. If pre-existing config is found and no Nori config exists yet, it offers to capture that config as a skillset named `"my-profile"`.

**Multi-agent broadcasting:** When capturing existing config or marking installation complete, the command loops over ALL default agents (via `getDefaultAgents()`) and calls the operation on each agent. Both `captureExistingConfig` and `markInstall` are broadcast to all agents in the default set, ensuring consistency across multi-agent setups.

### Things to Know

Config is persisted via `updateConfig()` from @/src/cli/config.ts, which automatically preserves all existing fields (auth credentials, autoupdate preference, transcript destination) when updating. The `initMain` function only persists `activeSkillset` and `version` to config -- it does not persist `installDir`, even when an `--install-dir` override is provided. The `--install-dir` flag is used at runtime to determine where to operate but is not written to `.nori-config.json`; only `sks config` persists `installDir`. The `skipWarning` parameter suppresses the skillset persistence warning during auto-init from download flows, where the warning would be confusing. Detection (`detectExistingConfig`, `isInstalledAtDir`) still uses only the first agent since it checks whether *any* agent is set up. Capture and mark operations broadcast to all agents to maintain consistency.

Created and maintained by Nori.
