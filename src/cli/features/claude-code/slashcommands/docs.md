# Noridoc: Global Slash Commands

Path: @/src/cli/features/claude-code/slashcommands

### Overview

Global slash commands loader that was previously used to register profile-agnostic Nori commands to `~/.claude/commands/`. This loader is now a no-op - global slash commands have been removed to reduce complexity and context token usage.

### How it fits into the larger codebase

```
┌─────────────────────────────────────────────────────────────────┐
│                      LoaderRegistry                             │
│  (execution order: config → profiles → hooks →                  │
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
    │  loader   │      │   loader    │    │   (no-op)   │
    └───────────┘      └─────────────┘    └─────────────┘
```

- **Registered in LoaderRegistry** (@/src/cli/features/claude-code/loaderRegistry.ts) after statusline loader
- **No-op implementation**: The loader exists for backwards compatibility but does not install any commands

### Core Implementation

- **Loader interface**: Implements the standard `Loader` interface with a `run()` method
- **run() is a no-op**: Logs "No global slash commands to register"

### Things to Know

**Why commands were removed:** Global slash commands were removed to reduce complexity and context token usage. The previous implementation included commands like `/nori-install-location`, `/nori-switch-profile`, `/nori-toggle-autoupdate`, `/nori-toggle-session-transcripts`, and `/nori-prune-context`, which were executed via hook interception. These features are now either removed entirely or accessible through other means (e.g., terminal commands).

**Profile commands still exist:** Profile-specific commands (like `nori-init-docs`) remain in each profile's `slashcommands/` directory and are handled by the profile slashcommands loader at @/src/cli/features/claude-code/profiles/slashcommands/loader.ts.

**Config directory deleted:** The `slashcommands/config/` directory that previously contained command markdown files has been deleted.

Created and maintained by Nori.
