# Noridoc: commands

Path: @/src/cli/commands

### Overview

The commands directory contains all CLI command implementations for the `nori-skillsets` CLI tool. Each command lives in its own subdirectory with a main implementation file and tests. The top-level files handle command name mapping and Commander.js registration.

### How it fits into the larger codebase

The CLI entry point delegates to `noriSkillsetsCommands.ts`, which registers every command with a Commander.js `program` instance. Each registration function imports the `*Main` entry point from the corresponding subdirectory and wires it to Commander options/arguments. Commands depend on `@/cli/config.js` for configuration, `@/cli/features/claude-code/` for agent-specific paths and skillset management, `@/api/` for registry API calls, and `@/cli/prompts/flows/` for interactive user prompts.

### Core Implementation

`cliCommandNames.ts` defines the `CommandNames` type and a lookup table that maps logical command names (e.g., `download`, `externalSkill`) to their CLI string equivalents. This is consumed by commands that need to display command hints in error messages.

`noriSkillsetsCommands.ts` is the central registration hub. It exports one `registerNoriSkillsets*Command` function per command, each taking a `{ program: Command }` argument. Many commands have hidden aliases (e.g., `switch` also registers `switch-skillset`, `switch-skillsets`, and `use`) to support both short and long forms.

### Things to Know

Command implementations follow a consistent pattern: the subdirectory exports a `*Main` function containing the business logic and a `register*Command` function for Commander registration. The `noriSkillsetsCommands.ts` file uses its own registration wrappers rather than calling `register*Command` directly, because it adds global option forwarding (e.g., `installDir`, `nonInteractive`, `silent`).

Created and maintained by Nori.
