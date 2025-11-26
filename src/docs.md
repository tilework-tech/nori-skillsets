# Noridoc: src

Path: @/plugin/src

### Overview

Source code for the Claude Code plugin package, including the installer CLI with directory-based profile system, feature loaders for profiles/skills/hooks/subagents/slash commands/status line/CLAUDE.md, API client for backend communication, and shared providers for Firebase authentication.

### How it fits into the larger codebase

This directory contains the plugin implementation defined in @/plugin/package.json. The installer at @/plugin/src/installer sets up Claude Code using a profile-based architecture where profiles are complete, self-contained configurations stored in @/plugin/src/installer/features/profiles/config/{profileName}/. Each profile directory contains CLAUDE.md, PROFILE.md, skills/, subagents/, and slashcommands/ subdirectories. Feature loaders at @/plugin/src/installer/features install components by copying files from the selected profile directory to ~/.claude/. The API client at @/plugin/src/api provides typed access to backend endpoints, mirroring @/ui/src/api but using Firebase authentication via the shared provider at @/plugin/src/providers/firebase.ts.

### Core Implementation

The installer uses a modular feature loader architecture where each component is installed by a separate loader from @/plugin/src/installer/features. The profiles loader (@/plugin/src/installer/features/profiles/loader.ts) copies entire profile directories from config/ to ~/.claude/profiles/. Other loaders (skills, subagents, slashcommands, claudemd) read from the selected profile directory and copy files to their respective ~/.claude/ locations. Configuration in ~/nori-config.json stores auth credentials (username, password, organizationUrl) and profile selection (profile.baseProfile). The CLAUDE.md loader reads the profile's CLAUDE.md file, generates a skills list by discovering all SKILL.md files in the profile's skills/ directory, and appends the skills list before inserting into ~/.claude/CLAUDE.md within a managed block. The status line script reads ~/nori-config.json to display both tier (free/paid) and profile name. The package is published to npm as nori-ai and installed globally via npm install -g nori-ai. Build process (npm run build) compiles TypeScript, bundles paid skills, copies profile directories to build/, sets executable permissions on scripts, and injects version strings into status line.

### Things to Know

The package has two installation modes: free (local-only, no backend) and paid (full backend integration). Three default profiles exist: senior-swe (co-pilot, default), amol (full autonomy), and product-manager (full autonomy for non-technical users). Each profile contains complete configuration including CLAUDE.md with instructions, PROFILE.md with frontmatter description, skills/ with both free and paid- prefixed skills, subagents/ with subagent definitions, and slashcommands/ with command definitions. During installation, paid- prefixed skills are only installed for paid installations (determined by `isPaidInstall({ config })` which checks if `config.auth != null`), and the paid- prefix is stripped when copying to ~/.claude/skills/. Paid skills are bundled by @/plugin/src/scripts/bundle-skills.ts which uses esbuild to inline all dependencies into standalone executables. The installer no longer supports JSON-based preference customization - profiles are the source of truth. The status line enriches context with both config_tier (free/paid) and profile_name by reading ~/nori-config.json, and displays the profile name if explicitly set. All feature loaders use managed blocks to preserve user customizations when updating files.
