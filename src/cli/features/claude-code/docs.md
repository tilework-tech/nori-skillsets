# Noridoc: claude-code

Path: @/src/cli/features/claude-code

### Overview

The Claude Code agent implementation. This directory contains the `Agent` interface implementation for Claude Code, along with path utilities, template substitution, config capture, factory reset, and the `LoaderRegistry` that orchestrates feature installation.

### How it fits into the larger codebase

`agent.ts` exports `claudeCodeAgent`, which is registered in `@/src/cli/features/agentRegistry.ts` as the sole agent implementation. The `LoaderRegistry` in `loaderRegistry.ts` defines the ordered pipeline of feature loaders that run during `nori-skillsets install`: config -> profiles -> hooks -> statusline -> announcements. CLI commands like init, watch, and switch interact with this agent through the `Agent` interface for install detection (`isInstalledAtDir`), skillset switching (`switchSkillset`), and factory reset.

### Core Implementation

The agent detects installation by checking for a `.nori-managed` marker file in `.claude/`, falling back to checking `CLAUDE.md` for a `NORI-AI MANAGED BLOCK` string for backwards compatibility. `paths.ts` centralizes all path computations, distinguishing between the install directory (`{installDir}/.claude/`) and the home directory (`~/.claude/`) -- hooks and statusline write to `~/.claude/settings.json` so they work from any subdirectory, while skillset-specific config (skills, CLAUDE.md, commands, agents) writes to the install directory. `template.ts` performs placeholder substitution (`{{skills_dir}}`, `{{profiles_dir}}`, `{{commands_dir}}`, `{{install_dir}}`) in skillset content, with support for escaping via backtick wrapping. `existingConfigCapture.ts` detects pre-existing unmanaged Claude Code config and can capture it as a named skillset. `factoryReset.ts` walks the ancestor directory tree to find and remove all `.claude/` directories and `CLAUDE.md` files.

### Things to Know

The `LoaderRegistry` enforces installation order: config must run before profiles because profiles depend on config state. The `switchSkillset` method on the agent validates that the target skillset exists (has `nori.json`) before updating `~/.nori-config.json`. The `markInstall` method writes the active skillset name into the `.nori-managed` marker file.

Created and maintained by Nori.
