# Noridoc: nori-skillsets

Path: @/

### Overview

Nori Skillsets is a CLI client and plugin package for installing and managing "skillsets" -- complete, packaged agent configurations for AI coding agents. It supports many agents (Claude Code, Cursor, Codex, and more) through a data-oriented `AgentConfig` type with shared operation functions; each agent is declared as one row in a single declarative table. It connects to the noriskillsets.dev registry to search, download, and upload skillsets and individual skills, while a parallel Git-backed path supports installing, creating, and independently forking local skillsets. The package is published to npm as `nori-skillsets` with binary aliases `nori-skillsets`, `nori-skillset`, and `sks`.

### How it fits into the larger codebase

This is the repository root. The project is a TypeScript Node.js application built with esbuild, using Commander for CLI parsing, Firebase for authentication, and the noriskillsets.dev registry as its backend. The CLI installs configuration into each agent's directory structure (e.g., `.claude/`, `.cursor/`, `.codex/`, etc.), where the respective agent reads it. Skillsets are stored in `~/.nori/profiles/` and activated by copying into each configured agent's target directory. The multi-agent architecture uses a single `AgentConfig` type (defined in @/src/cli/features/agentRegistry.ts) with shared lifecycle operations in @/src/cli/features/agentOperations.ts, so all agents share the same install/switch/remove logic. Every agent is declared as a row in the agent table at @/src/cli/features/agentTable.ts (paths, capabilities, support tier), and the registry builds all agents from that table.

This repo participates in the Nori shared local runner layer -- a cross-repo convention providing standardized `just` targets (`help`, `dev`, `test`, `doctor`) for orientation and discovery. The same target contract exists in `sessions`, `registrar`, `admin`, and `cli`.

```
User runs CLI command
        |
        v
  @/src/cli/nori-skillsets.ts  (entrypoint)
        |
        v
  @/src/cli/commands/*         (individual commands)
        |
        v
  @/src/api/*                  (registry + auth API clients)
  @/src/cli/features/*         (agent integration, skillset management)
  @/src/norijson/*             (manifest parsing)
  @/src/providers/*            (Firebase singleton)
  @/src/utils/*                (URL, path, fetch helpers)
```

### Core Implementation

The CLI entrypoint is `@/src/cli/nori-skillsets.ts`, which registers all commands via Commander. Configuration is persisted at `~/.nori-config.json` and managed by `@/src/cli/config.ts` with JSON Schema validation (via Ajv). Authentication supports Firebase refresh tokens (preferred interactive), broker-managed short-lived Firebase ID tokens for session machines, legacy Firebase passwords (deprecated), and raw API tokens for non-interactive / CI access to private-org registrars at `{orgId}.noriskillsets.dev`. API tokens are self-describing — the format `nori_<orgId>_<64 hex chars>` encodes the scope in the token itself, so no separate orgId flag or env var is required. Per-request auth resolution happens in `@/src/api/base.ts` and `@/src/api/registryAuth.ts` with precedence: `NORI_API_TOKEN` env var (scoped match) > config `auth.apiToken` (scoped match) > unexpired config `auth.idToken` > refresh-token exchange > password. The orgId is parsed on demand from the token via `extractOrgIdFromApiToken` in `@/src/utils/apiToken.ts`. Firebase tokens are cached at multiple levels (`@/src/api/base.ts`, `@/src/api/refreshToken.ts`, `@/src/api/registryAuth.ts`); API tokens are never cached.

The build process compiles TypeScript, resolves `@/` path aliases via `tsc-alias`, and then bundles hook scripts into standalone executables using esbuild (`@/src/scripts/bundle-skills.ts`).

**Publishing process:** Releases are created exclusively through CI/CD (see `@/.github/workflows/docs.md`). All publishing goes through a single workflow, `@/.github/workflows/skillsets-release.yml`, which handles tag pushes (stable `@latest`), pushes to `main` (`@next` prereleases), and manual dispatch. Stable releases go through `@/scripts/create_skillsets_release.py`, which creates a git tag that triggers the workflow. All npm publishing uses OIDC Trusted Publishing, which requires a single whitelisted workflow file. Direct `npm publish` is blocked by a safeguard in `@/scripts/prepublish.sh` (invoked via the `prepublishOnly` npm hook in `@/package.json`).

**Local runner layer:** The `@/justfile` provides standardized `just` targets that wrap existing npm scripts. Integration tests for the justfile live at `@/tests/justfile.test.ts`.

### Things to Know

The config system supports two formats: a legacy flat format (pre-v19) with credentials at the root level, and a nested `auth: {...}` format (v19+). Both are handled transparently by `loadConfig()` in `@/src/cli/config.ts` and `ConfigManager.loadConfig()` in `@/src/api/base.ts`.

The registrar API (`@/src/api/registrar.ts`) uses a fallback mechanism: requests to `/api/skillsets/` that return 404 are silently retried against `/api/profiles/` to support older registry servers. Skillset operations and skill operations use separate API endpoint paths (`/api/skillsets/` vs `/api/skills/`).

The `prepublishOnly` npm hook serves as a safeguard against accidental direct publishing rather than as an active part of the release workflow. It exits with a non-zero status and instructs the user to use the proper release script.

The repo's agent instruction file is `@/AGENTS.md` -- this is the single source of truth for agent-facing instructions (style guide, disambiguation rules, close-the-loop verification). `@/CLAUDE.md` is a symlink to `AGENTS.md`, preserving Claude Code's auto-discovery while keeping `AGENTS.md` canonical. The last `## ` section in `AGENTS.md` is "Critical: How to Close the Loop", which provides agents with end-to-end verification steps organized by command type (non-interactive, interactive, registry-dependent). Structural invariants of these files are enforced by tests in `@/tests/agents-md.test.ts`.

Created and maintained by Nori.
