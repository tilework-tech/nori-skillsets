# Noridoc: cursor

Path: @/src/cli/features/cursor

### Overview

Feature loader registry and implementations for installing Nori components into Cursor IDE. Uses a separate CursorLoaderRegistry singleton that mirrors the main LoaderRegistry pattern but writes to `~/.cursor/` instead of `~/.claude/`. Implements profiles and slash commands installation.

### How it fits into the larger codebase

This directory provides Cursor IDE support parallel to the main Claude Code installation system. The architecture mirrors @/src/cli/features/ but operates on Cursor-specific paths:

```
+----------------------+     +------------------------+
|    LoaderRegistry    |     |  CursorLoaderRegistry  |
|   (@/src/cli/        |     |  (@/src/cli/features/  |
|    features/)        |     |   cursor/)             |
+----------------------+     +------------------------+
         |                            |
         v                            v
    ~/.claude/                   ~/.cursor/
    - profiles/                  - profiles/
    - settings.json              - settings.json
    - skills/                    - commands/
    - commands/
    - hooks/
```

The `install-cursor` command (@/src/cli/commands/install-cursor/installCursor.ts) uses CursorLoaderRegistry to execute all registered Cursor loaders. The cursor profiles loader reuses the same profile template source files from @/src/cli/features/profiles/config/ but writes to `~/.cursor/profiles/` via Cursor-specific path helpers in @/src/cli/env.ts.

Cursor environment path helpers (getCursorDir, getCursorSettingsFile, getCursorProfilesDir, getCursorCommandsDir, getCursorHomeDir, getCursorHomeSettingsFile) in @/src/cli/env.ts parallel the existing Claude path helpers.

### Core Implementation

**CursorLoaderRegistry** (cursorLoaderRegistry.ts): Singleton registry managing Cursor feature loaders. Implements the same interface as LoaderRegistry with getAll() and getAllReversed() methods. Registers cursorProfilesLoader and cursorSlashCommandsLoader.

**Cursor Profiles Loader** (profiles/loader.ts): Installs profile templates to `~/.cursor/profiles/`. Key behaviors:
- Reuses profile templates from @/src/cli/features/profiles/config/ (no separate Cursor templates)
- Applies mixin composition logic identical to the Claude profiles loader
- Configures permissions by updating `~/.cursor/settings.json` with additionalDirectories
- Validates installation by checking required profiles and permissions configuration

**Cursor Slash Commands Loader** (slashcommands/loader.ts): Installs slash command markdown files to `~/.cursor/commands/`. Key behaviors:
- Reuses command markdown files from @/src/cli/features/slashcommands/config/ (shared with Claude loader)
- Applies template path substitution with `getCursorDir` so paths resolve to `~/.cursor/` instead of `~/.claude/`
- Validates installation by checking all expected commands are present in the commands directory

### Things to Know

Both loaders implement the same `Loader` interface from @/src/cli/features/loaderRegistry.ts, enabling consistent run/uninstall/validate behavior. The profiles loader:
- Injects conditional paid mixins based on config.auth presence (isPaidUser check)
- Composes profiles from mixins in alphabetical order
- Updates Cursor settings.json with profiles directory in permissions.additionalDirectories
- During uninstall, only removes builtin profiles (identified by `"builtin": true` in profile.json), preserving user-created profiles

The slash commands loader reads markdown files from the shared config directory at @/src/cli/features/slashcommands/config/, applies template substitution using `getCursorDir` (not `getClaudeDir`), and writes to `~/.cursor/commands/`. During uninstall, removes only commands that match the source config directory contents, and cleans up the directory if empty.

The CursorLoaderRegistry is intentionally separate from LoaderRegistry to allow independent loader management. Future Cursor features (hooks, statusline, skills, etc.) would add their own loaders registered in this registry.

Created and maintained by Nori.
