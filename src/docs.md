# Noridoc: src

Path: @/src

### Overview

Source code for the Claude Code plugin package, including the installer CLI with directory-based profile system, feature loaders for profiles/skills/hooks/subagents/slash commands/status line/CLAUDE.md, API client for backend communication, and shared providers for Firebase authentication.

### How it fits into the larger codebase

This directory contains the plugin implementation defined in @/package.json. The installer at @/src/cli sets up Claude Code using a profile-based architecture where profiles are complete, self-contained configurations. The package does not ship any built-in profiles -- profiles are obtained from the registry or created by users and stored in `~/.nori/profiles/`. Each profile directory contains CLAUDE.md, skills/, subagents/, and slashcommands/ subdirectories. Feature loaders at @/src/cli/features/claude-code/ install components by copying files from the selected profile directory to ~/.claude/. The `features/` directory is organized by agent type, with `claude-code/` and `cursor-agent/` containing agent-specific loaders. The API client at @/src/api provides typed access to backend endpoints, using Firebase authentication via the shared provider at @/src/providers/firebase.ts.

### Core Implementation

The installer uses a modular feature loader architecture where each component is installed by a separate loader from @/src/cli/features/claude-code/. The profiles loader (@/src/cli/features/claude-code/profiles/loader.ts) ensures `~/.nori/profiles/` exists and configures permissions. Other loaders (skills, subagents, slashcommands, claudemd) read from the selected profile in `~/.nori/profiles/` and copy files to their respective `~/.claude/` locations. Configuration in `.nori-config.json` stores auth credentials and profile selection. The CLAUDE.md loader reads the profile's CLAUDE.md file, generates a skills list by discovering all SKILL.md files in the profile's skills/ directory, and appends the skills list before inserting into `~/.claude/CLAUDE.md` within a managed block. The status line script reads `.nori-config.json` to display profile name. The package is published to npm as nori-skillsets and installed globally. Build process (npm run build) compiles TypeScript, bundles hook scripts, sets executable permissions on scripts, and injects version strings into status line.

### Things to Know

No built-in profiles are shipped -- users obtain profiles from the registry or create their own. Each profile contains complete configuration including CLAUDE.md with instructions, nori.json manifest, skills/ with skill directories, subagents/ with subagent definitions, and slashcommands/ with command definitions. During installation, all skills from the profile's skills/ directory are copied to `~/.claude/skills/`. Hook scripts are bundled by @/src/scripts/bundle-skills.ts which uses esbuild to inline all dependencies into standalone executables. The status line enriches context with profile_name by reading `.nori-config.json`, and displays the profile name if explicitly set. All feature loaders use managed blocks to preserve user customizations when updating files.
