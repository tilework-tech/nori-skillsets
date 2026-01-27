# Noridoc: Global Slash Commands

Path: @/src/cli/features/claude-code/slashcommands

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

- **Registered in LoaderRegistry** (@/src/cli/features/claude-code/loaderRegistry.ts) after statusline loader
- **Part of "global settings" group**: During uninstall, hooks, statusline, and slashcommands are treated as a unit that can be preserved together when `removeGlobalSettings` is false
- **Separate from profile slash commands**: Profile-specific commands (like `nori-init-docs`) are inlined in each profile's `slashcommands/` directory and are handled by the profile slashcommands loader at @/src/cli/features/claude-code/profiles/slashcommands/loader.ts
- **Template substitution**: Uses `substituteTemplatePaths()` to replace placeholders like `{{skills_dir}}`, `{{profiles_dir}}` with actual installation paths

### Core Implementation

- **Loader interface**: Implements the standard `Loader` interface with `run()`, `uninstall()`, and `validate()` methods
- **Static command list**: Commands are defined in `GLOBAL_SLASH_COMMANDS` array in @/src/cli/features/claude-code/slashcommands/loader.ts
- **Source files**: Markdown command definitions stored in @/src/cli/features/claude-code/slashcommands/config/
- **Installation target**: Commands are always copied to `~/.claude/commands/` using `getClaudeHomeCommandsDir()`
- **Validation**: Checks that all expected global commands exist in the commands directory

### Things to Know

**Global commands vs profile commands**: Global commands are installed once and work identically regardless of profile. Profile commands vary based on the active profile's content.

| Command Type | Source Location | Loader | Examples |
|-------------|-----------------|--------|----------|
| Global | @/src/cli/features/claude-code/slashcommands/config/ | globalSlashCommandsLoader | nori-debug, nori-switch-profile, nori-info |
| Profile | Each profile's `slashcommands/` directory | slashCommandsLoader (profiles) | nori-init-docs |

**Hook-intercepted commands**: Several global commands (`nori-switch-profile`, `nori-toggle-autoupdate`, `nori-toggle-session-transcripts`, `nori-install-location`, `nori-prune-context`) are intercepted by the slash-command-intercept hook and executed directly by TypeScript code rather than by Claude. The markdown files still provide the `description` frontmatter for Claude Code's command palette.

**Uninstall behavior**: When uninstalling, the loader only removes files matching the `GLOBAL_SLASH_COMMANDS` list. Custom user commands in `~/.claude/commands/` are preserved.

Created and maintained by Nori.
