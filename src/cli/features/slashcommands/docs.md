# Noridoc: Global Slash Commands

Path: @/src/cli/features/slashcommands

### Overview

Profile-agnostic slash commands installed directly to `~/.claude/commands/` independent of profile selection. These commands provide Nori system utilities that work the same regardless of which profile is active.

### How it fits into the larger codebase

```
┌─────────────────────────────────────────────────────────────────┐
│                      LoaderRegistry                             │
│  (execution order: version → config → profiles → hooks →        │
│   statusline → slashcommands → announcements)                   │
└─────────────────────────────────────────────────────────────────┘
                              │
          ┌───────────────────┼───────────────────┐
          │                   │                   │
          ▼                   ▼                   ▼
   Global Settings      Global Settings     Global Settings
   (to ~/.claude/)      (to ~/.claude/)     (to ~/.claude/)
          │                   │                   │
    ┌─────┴─────┐      ┌──────┴──────┐    ┌──────┴──────┐
    │   hooks   │      │ statusline  │    │slashcommands│
    │  loader   │      │   loader    │    │   loader    │
    └───────────┘      └─────────────┘    └─────────────┘
```

- **Registered in LoaderRegistry** (@/src/cli/features/loaderRegistry.ts) after statusline loader
- **Part of "global settings" group**: During uninstall, hooks, statusline, and slashcommands are treated as a unit that can be preserved together when `removeGlobalSettings` is false (see @/src/cli/commands/uninstall/uninstall.ts)
- **Separate from profile slash commands**: Profile-specific commands (like `nori-init-docs`, `nori-sync-docs`) remain in profile mixins at @/src/cli/features/profiles/config/_mixins/ and are handled by the profile slashcommands loader at @/src/cli/features/profiles/slashcommands/loader.ts
- **Template substitution**: Uses `substituteTemplatePaths()` from @/src/utils/template.ts to replace placeholders like `{{skills_dir}}`, `{{profiles_dir}}` with actual installation paths

### Core Implementation

- **Loader interface**: Implements the standard `Loader` interface with `run()`, `uninstall()`, and `validate()` methods
- **Static command list**: Commands are defined in `GLOBAL_SLASH_COMMANDS` array in @/src/cli/features/slashcommands/loader.ts - this list must be updated when adding/removing global commands
- **Source files**: Markdown command definitions stored in @/src/cli/features/slashcommands/config/
- **Installation target**: Commands are copied to `~/.claude/commands/` (or `{installDir}/.claude/commands/` for custom installs)
- **Validation**: Checks that all expected global commands exist in the commands directory

### Things to Know

**Global commands vs profile commands**: Global commands are installed once and work identically regardless of profile. Profile commands vary based on the active profile's mixins.

| Command Type | Source Location | Loader | Examples |
|-------------|-----------------|--------|----------|
| Global | @/src/cli/features/slashcommands/config/ | globalSlashCommandsLoader | nori-debug, nori-switch-profile, nori-info |
| Profile | @/src/cli/features/profiles/config/_mixins/*/slashcommands/ | slashCommandsLoader (profiles) | nori-init-docs, nori-sync-docs |

**Hook-intercepted commands**: Several global commands (`nori-switch-profile`, `nori-toggle-autoupdate`, `nori-toggle-session-transcripts`, `nori-install-location`) are intercepted by the slash-command-intercept hook and executed directly by TypeScript code rather than by Claude. The markdown files still provide the `description` frontmatter for Claude Code's command palette.

**Uninstall behavior**: When uninstalling, the loader only removes files matching the `GLOBAL_SLASH_COMMANDS` list. Custom user commands in `~/.claude/commands/` are preserved. The commands directory is only removed if empty after cleanup.

Created and maintained by Nori.
