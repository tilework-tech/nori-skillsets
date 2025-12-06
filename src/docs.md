# Noridoc: src

Path: @/plugin/src

### Overview

Source code for the Claude Code plugin package, including the installer CLI with directory-based profile system, feature loaders for profiles/skills/hooks/subagents/slash commands/status line/CLAUDE.md, API client for backend communication, and shared providers for Firebase authentication.

### How it fits into the larger codebase

This directory contains the plugin implementation defined in @/plugin/package.json. The CLI at @/plugin/src/cli sets up Claude Code using a multi-agent architecture where agents (currently only "claude-code") have their own LoaderRegistry and profile configurations. Profile composition uses mixins stored in @/plugin/src/cli/agents/claude/profiles/config/_mixins/. The AgentRegistry (@/plugin/src/cli/agents/agentRegistry.ts) maps agent names to their configurations. Feature loaders at @/plugin/src/cli/agents/claude/ install components by composing profiles and copying files to ~/.claude/. The API client at @/plugin/src/api provides typed access to backend endpoints, mirroring @/ui/src/api but using Firebase authentication via the shared provider at @/plugin/src/providers/firebase.ts.

### Core Implementation

The CLI uses a modular feature loader architecture where each component is installed by a separate loader from @/plugin/src/cli/agents/claude/. The profilesLoader (@/plugin/src/cli/agents/claude/profiles/loader.ts) composes profiles from mixins and copies them to ~/.claude/profiles/. Profile composition merges CLAUDE.md files, skills/, subagents/, and slashcommands/ from mixin directories. Configuration in ~/nori-config.json stores auth credentials (username, password, organizationUrl), profile selection (profile.baseProfile), and installedAgents array for multi-agent tracking. The profilesLoader generates CLAUDE.md with skills lists by discovering all SKILL.md files and extracting frontmatter metadata. The status line script reads ~/nori-config.json to display both tier (free/paid) and profile name. The package is published to npm as nori-ai and installed globally via npm install -g nori-ai. Build process (npm run build) compiles TypeScript, bundles paid skills, copies profile directories from `src/cli/agents/claude/` to build/, sets executable permissions on scripts, and injects version strings into status line.

### Things to Know

The package has two installation modes: free (local-only, no backend) and paid (full backend integration). Three default profiles exist: senior-swe (co-pilot, default), amol (full autonomy), and product-manager (full autonomy for non-technical users). Each profile contains complete configuration including CLAUDE.md with instructions, PROFILE.md with frontmatter description, skills/ with both free and paid- prefixed skills, subagents/ with subagent definitions, and slashcommands/ with command definitions. During installation, paid- prefixed skills are only installed for paid installations (determined by `isPaidInstall({ config })` which checks if `config.auth != null`), and the paid- prefix is stripped when copying to ~/.claude/skills/. Paid skills are bundled by @/plugin/src/scripts/bundle-skills.ts which uses esbuild to inline all dependencies into standalone executables. The installer no longer supports JSON-based preference customization - profiles are the source of truth. The status line enriches context with both config_tier (free/paid) and profile_name by reading ~/nori-config.json, and displays the profile name if explicitly set. All feature loaders use managed blocks to preserve user customizations when updating files.
