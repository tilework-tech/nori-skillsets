# Noridoc: init

Path: @/src/cli/commands/init

### Overview

The init command performs first-time setup of the Nori environment. It creates the config file (`.nori-config.json`), the skillsets directory (`~/.nori/profiles/`), and optionally captures an existing Claude Code configuration as a named skillset.

### How it fits into the larger codebase

This command is the entry point for new installations and is also called implicitly by the `registry-download` command when no config exists. It interacts with `@/cli/config.js` for loading/saving the global config, `@/cli/features/agentRegistry.js` for agent-specific detection and installation marking, `@/cli/features/paths.js` for shared Nori directory locations and `@/cli/features/claude-code/paths.js` for Claude-specific paths, and `@/cli/prompts/flows/init.js` for the interactive setup wizard.

### Core Implementation

`initMain` has two code paths: interactive (default) and non-interactive (`--nonInteractive`). Both paths create the `~/.nori/profiles/` directory and save a config file. The interactive path delegates to `initFlow` with callbacks for ancestor checking, existing config detection, config capture, and final initialization. The non-interactive path performs the same steps inline.

The existing-config detection flow checks whether the default agent (resolved from `AgentRegistry`) already has configuration at the install directory. If pre-existing Claude Code config is found and no Nori config exists yet, it offers to capture that config as a skillset named `"my-profile"`.

### Things to Know

The config save preserves all existing fields (auth credentials, autoupdate preference, transcript destination) when updating. The `skipWarning` parameter suppresses the skillset persistence warning during auto-init from download flows, where the warning would be confusing. `markInstall` on the agent is called at the end to record that setup is complete for the given directory.

Created and maintained by Nori.
