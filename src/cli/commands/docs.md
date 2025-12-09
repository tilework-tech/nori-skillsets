# Noridoc: commands

Path: @/plugin/src/cli/commands

### Overview

Contains all CLI command implementations for the nori-ai CLI. Each command lives in its own subdirectory with its implementation, tests, and any command-specific utilities co-located together.

### How it fits into the larger codebase

The main CLI entry point (@/plugin/src/cli/cli.ts) imports `registerXCommand` functions from each command subdirectory and calls them to register commands with the Commander.js program. Each command module exports a register function that accepts `{ program: Command }` and adds its command definition. Commands access global options (`--install-dir`, `--non-interactive`) via `program.opts()`. Business logic is encapsulated within each command directory - cli.ts only handles routing.

```
cli.ts
  |
  +-- registerInstallCommand({ program })      --> commands/install/install.ts
  +-- registerInstallCursorCommand({ program })--> commands/install-cursor/installCursor.ts
  +-- registerUninstallCommand({ program })    --> commands/uninstall/uninstall.ts
  +-- registerCheckCommand({ program })        --> commands/check/check.ts
  +-- registerSwitchProfileCommand({ program })--> commands/switch-profile/profiles.ts
  +-- registerInstallLocationCommand({ program })--> commands/install-location/installLocation.ts
  +-- registerRegistrySearchCommand({ program })--> commands/registry-search/registrySearch.ts
  +-- registerRegistryDownloadCommand({ program })--> commands/registry-download/registryDownload.ts
  +-- registerRegistryUploadCommand({ program })--> commands/registry-upload/registryUpload.ts
```

Commands use shared utilities from the parent @/plugin/src/cli/ directory:
- `config.ts` - Config type and persistence
- `logger.ts` - Console output formatting (error, success, info, warn)
- `prompt.ts` - User input prompting
- `version.ts` - Version tracking for upgrades
- `analytics.ts` - GA4 event tracking

Commands also use feature loaders from @/plugin/src/cli/features/ via the LoaderRegistry for installation/uninstallation operations.

### Core Implementation

**Command Directory Pattern:** Each command directory contains:
- `{command}.ts` - Main implementation with `registerXCommand` export and business logic
- `{command}.test.ts` - Unit/integration tests
- Command-specific utilities (e.g., `install/asciiArt.ts`, `install/installState.ts`)

**Command Registration Pattern:** Each command exports a register function:
```typescript
export const registerXCommand = (args: { program: Command }): void => {
  const { program } = args;
  program
    .command("command-name")
    .description("...")
    .action(async () => {
      const globalOpts = program.opts();
      await main({ installDir: globalOpts.installDir || null });
    });
};
```

**Import Path Pattern:** Commands import from `@/cli/` for shared utilities and `@/cli/features/` for loaders. Within the install command, relative imports are used for command-specific utilities (e.g., `./asciiArt.js`, `./installState.js`).

### Things to Know

The `install/` directory contains command-specific utilities:
- `asciiArt.ts` - ASCII banners displayed during installation
- `installState.ts` - Helper to check for existing installations (wraps version.ts)
- `registryAuthPrompt.ts` - Prompts for private registry authentication during interactive install. Collects registry URL, username, and password (hidden input). Supports preserving existing registryAuths from config and adding multiple registries. Uses `RegistryAuth` type from `@/cli/config.js`.

The `install-location/` command was extracted from inline definition in cli.ts to follow the same pattern as other commands.

Tests within each command directory use the same temp directory isolation pattern as other tests in the codebase, passing `installDir` explicitly to functions rather than mocking `process.env.HOME`.

Created and maintained by Nori.
