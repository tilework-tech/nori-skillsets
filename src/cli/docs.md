# Noridoc: cli

Path: @/src/cli

### Overview

The CLI module is the top-level entry point for the `nori-skillsets` command-line tool. It wires together command registration, configuration management, logging, analytics tracking, and auto-update checking into a single executable powered by the Commander library.

### How it fits into the larger codebase

The CLI module is the outermost shell of the application. `nori-skillsets.ts` is the executable entry point that bootstraps the process: it initializes proxy support from `@/utils/fetch`, sets up analytics via `installTracking.ts`, checks for updates via `@/cli/updates`, and registers all commands defined in `@/cli/commands/noriSkillsetsCommands`. Commands delegate their interactive UX to `@/cli/prompts/flows` and their business logic to `@/cli/features` and `@/api`. Configuration state flows through `config.ts`, which reads and writes `~/.nori-config.json` and is consumed by nearly every other module in the codebase.

### Core Implementation

`nori-skillsets.ts` creates a Commander `program`, attaches global options (`--install-dir`, `--non-interactive`, `--silent`, `--agent`), and registers all subcommands. Before parsing, it fires a background analytics lifecycle event and runs the update check (skipped for `--help`/`--version`).

`config.ts` manages the `~/.nori-config.json` file using AJV schema validation. It handles two auth formats: a legacy flat format (username/password at root level) and a nested `auth` object (v19+). Key exports include `loadConfig`, `saveConfig`, `getRegistryAuth` (derives registry credentials from the org URL), `getActiveSkillset`, and `getDefaultAgents` (resolution order: CLI flag override, then config, then `["claude-code"]`). The config schema includes several behavioral toggle fields that follow an `"enabled" | "disabled"` pattern with schema-level defaults: `autoupdate`, `garbageCollectTranscripts`, and `redownloadOnSwitch` (which controls whether the switch command prompts to re-download the skillset from the registry, defaulting to `"enabled"`).

`logger.ts` provides file-only logging to `/tmp/nori.log` via Winston and ANSI color helpers. All user-facing console output has been migrated to `@clack/prompts` (`log.success`, `log.info`, `log.error`, `log.warn`, `note()`, `intro()`, `outro()`). The logger retains file-only `debug` logging, a silent mode flag (used by install ASCII art to guard output), ANSI color helpers (`bold`, `dim`, `red`, `green`, etc.), and a text wrapping utility.

`installTracking.ts` manages install lifecycle analytics. It maintains a `.nori-install.json` state file in `~/.nori/profiles/`, tracks first-install vs upgrade vs resurrection events, and sends fire-and-forget analytics via the Nori analytics proxy. It generates a deterministic client ID from hostname + username.

`version.ts` resolves the package version by walking up the directory tree to find `package.json`. It also reads the installed version from config (with fallback to a deprecated `.nori-installed-version` file) and checks `--agent` flag support via semver comparison.

### Things to Know

The config module supports both legacy flat auth fields and nested `auth` objects for backward compatibility. `loadConfig` normalizes both formats into the same `Config` type. The schema validation uses `removeAdditional: true`, so unknown fields are silently stripped.

Analytics are strictly fire-and-forget with 5-second timeouts and silent error handling, ensuring they never block CLI operations. The `NORI_NO_ANALYTICS=1` env var opts out entirely.

The auto-update check runs before command parsing but after analytics setup. It uses a stale-while-revalidate cache pattern (see `@/cli/updates`) and can be disabled via the `autoupdate: "disabled"` config setting.

Created and maintained by Nori.
