# Noridoc: commands

Path: @/plugin/src/installer/commands

### Overview

Command registration modules for the Commander.js-based CLI. Each command is a separate module that exports a registration function to configure the commander program with command-specific options and action handlers.

### How it fits into the larger codebase

This directory contains modular command definitions for the nori-ai CLI. The main CLI entry point at @/plugin/src/installer/cli.ts creates a Commander.js program instance and delegates to these registration modules. Each module follows the pattern: `export const register*Command = (args: { program: Command }) => { ... }`. The registration functions call `program.command()` to define the command name, description, and action handler. Commands inherit global options (`--install-dir`, `--non-interactive`) from the parent program and access them via `program.opts()` within their action handlers. All business logic remains in the domain layer files (@/plugin/src/installer/install.ts, @/plugin/src/installer/uninstall.ts, @/plugin/src/installer/profiles.ts) - command modules are thin wrappers responsible ONLY for parsing CLI arguments and routing to the appropriate domain function.

The separation between CLI layer (this directory + @/plugin/src/installer/cli.ts) and domain layer (@/plugin/src/installer/*.ts) means:
- CLI framework (Commander.js) can be swapped without touching business logic
- Commands can be tested independently by mocking domain functions
- Adding new commands requires only creating a new file in this directory and registering it in cli.ts

### Core Implementation

**Command Registration Pattern:**
Each command module exports a `register*Command({ program })` function that:
1. Calls `program.command(name)` to define the command
2. Calls `.description()` to set help text
3. Calls `.action(async () => { ... })` to define the handler
4. Accesses global options via `program.opts()` within the action handler
5. Calls the domain function with parsed arguments

**Global Options Inheritance:**
The main program in @/plugin/src/installer/cli.ts defines global options:
- `--install-dir <path>` - Custom installation directory, normalized via `normalizeInstallDir()`
- `--non-interactive` - Run without interactive prompts (for autoupdate flow)

These options are defined once on the parent program and automatically available to all subcommands via `program.opts()`.

**Command Modules:**
- `install.ts` - Registers the `install` command, routes to `installMain()` from @/plugin/src/installer/install.ts
- `uninstall.ts` - Registers the `uninstall` command, routes to `uninstallMain()` from @/plugin/src/installer/uninstall.ts
- `check.ts` - Registers the `check` command, contains inline `checkMain()` function that validates installation and config
- `switchProfile.ts` - Registers the `switch-profile <name>` command, routes to `switchProfile()` then `installMain()` with `skipUninstall=true`

### Things to Know

**Adding New Commands:**
To add a new command:
1. Create a new file in this directory (e.g., `myCommand.ts`)
2. Export a `registerMyCommand({ program })` function following the pattern above
3. Import and call it in @/plugin/src/installer/cli.ts after other `register*Command()` calls
4. Business logic should be in @/plugin/src/installer/, not in the command module

**Default Command Behavior:**
When `nori-ai` is run with no command, the CLI defaults to `install`. This is handled by a default action handler in @/plugin/src/installer/cli.ts using `program.action()`.

**Commander.js Features Used:**
- Automatic `--help` generation from command descriptions
- Automatic `--version` flag (reads version from package.json)
- Automatic unknown command detection and error messages
- Global options inherited by all subcommands
- Required arguments (e.g., `<name>` in `switch-profile <name>`) validated automatically

**Test Strategy:**
Tests in @/plugin/src/installer/cli.test.ts verify behavior, not implementation:
- Commands route to correct domain functions
- Options are parsed and passed correctly
- Validation happens before handlers are called (e.g., missing required arguments)
- Default commands work as expected
- Help and version flags work without calling handlers

Tests mock the domain functions (installMain, uninstallMain, switchProfile) to isolate CLI routing logic from business logic.

Created and maintained by Nori.
