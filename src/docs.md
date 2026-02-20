# Noridoc: src

Path: @/src

### Overview

Source code for the Claude Code plugin package, including the installer CLI with directory-based skillset system, feature loaders for skillsets/skills/hooks/subagents/slash commands/status line/CLAUDE.md, API client for backend communication, and shared providers for Firebase authentication.

### How it fits into the larger codebase

This directory contains the plugin implementation defined in @/package.json. The installer at @/src/cli sets up Claude Code using a skillset-based architecture where profiles are complete, self-contained configurations. The package does not ship any built-in skillsets -- skillsets are obtained from the registry or created by users and stored in `~/.nori/profiles/`. Each skillset directory contains CLAUDE.md, skills/, subagents/, and slashcommands/ subdirectories. Feature loaders at @/src/cli/features/claude-code/ install components by copying files from the selected skillset directory to ~/.claude/. The API client at @/src/api provides typed access to backend endpoints, using Firebase authentication via the shared provider at @/src/providers/firebase.ts.

### Core Implementation

The installer uses a modular feature loader architecture where each component is installed by a separate loader from @/src/cli/features/claude-code/. The skillsets loader (@/src/cli/features/claude-code/skillsets/loader.ts) ensures `~/.nori/profiles/` exists and configures permissions. Other loaders (skills, subagents, slashcommands, claudemd) read from the selected profile in `~/.nori/profiles/` and copy files to their respective `~/.claude/` locations. Configuration in `.nori-config.json` stores auth credentials and profile selection. The CLAUDE.md loader reads the skillset's CLAUDE.md file, generates a skills list by discovering all SKILL.md files in the skillset's skills/ directory, and appends the skills list before inserting into `~/.claude/CLAUDE.md` within a managed block. The status line script reads `.nori-config.json` to display skillset name. The package is published to npm as nori-skillsets and installed globally. Build process (npm run build) compiles TypeScript, bundles hook scripts, sets executable permissions on scripts, and injects version strings into status line.

### Things to Know

No built-in skillsets are shipped -- users obtain skillsets from the registry or create their own. Each skillset contains complete configuration including CLAUDE.md with instructions, nori.json manifest, skills/ with skill directories, subagents/ with subagent definitions, and slashcommands/ with command definitions. During installation, all skills from the skillset's skills/ directory are copied to `~/.claude/skills/`. Hook scripts are bundled by @/src/scripts/bundle-skills.ts which uses esbuild to inline all dependencies into standalone executables. The status line enriches context with skillset_name by reading `.nori-config.json`, and displays the skillset name if explicitly set. All feature loaders use managed blocks to preserve user customizations when updating files.
