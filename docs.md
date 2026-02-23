# Noridoc: nori-skillsets

Path: @/

### Overview

Nori Skillsets is a CLI client and plugin package for installing and managing "skillsets" -- complete, packaged agent configurations for Claude Code. It connects to the noriskillsets.dev registry to search, download, upload, and switch between skillsets and individual skills. The package is published to npm as `nori-skillsets` with binary aliases `nori-skillsets`, `nori-skillset`, and `sks`.

### How it fits into the larger codebase

This is the repository root. The project is a TypeScript Node.js application built with esbuild, using Commander for CLI parsing, Firebase for authentication, and the noriskillsets.dev registry as its backend. The CLI installs configuration into the user's `~/.claude/` directory structure, where Claude Code reads it. Skillsets are stored in `~/.nori/profiles/` and activated by copying into the target `.claude/` directory.

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

The CLI entrypoint is `@/src/cli/nori-skillsets.ts`, which registers all commands via Commander. Configuration is persisted at `~/.nori-config.json` and managed by `@/src/cli/config.ts` with JSON Schema validation (via Ajv). Authentication flows through Firebase -- either legacy password auth or refresh-token-based auth -- with token caching at multiple levels (`@/src/api/base.ts`, `@/src/api/refreshToken.ts`, `@/src/api/registryAuth.ts`).

The build process compiles TypeScript, resolves `@/` path aliases via `tsc-alias`, and then bundles hook scripts into standalone executables using esbuild (`@/src/scripts/bundle-skills.ts`).

**Publishing process:** Releases are created exclusively through CI/CD (see `@/.github/workflows/docs.md`). Stable releases go through `@/scripts/create_skillsets_release.py`, which creates a git tag that triggers `@/.github/workflows/skillsets-release.yml`. Additionally, every push to `main` automatically publishes a `@next` prerelease to npm via `@/.github/workflows/auto-next.yml`, which calls the same release workflow as a reusable workflow. Direct `npm publish` is blocked by a safeguard in `@/scripts/prepublish.sh` (invoked via the `prepublishOnly` npm hook in `@/package.json`).

### Things to Know

The config system supports two formats: a legacy flat format (pre-v19) with credentials at the root level, and a nested `auth: {...}` format (v19+). Both are handled transparently by `loadConfig()` in `@/src/cli/config.ts` and `ConfigManager.loadConfig()` in `@/src/api/base.ts`.

The registrar API (`@/src/api/registrar.ts`) uses a fallback mechanism: requests to `/api/skillsets/` that return 404 are silently retried against `/api/profiles/` to support older registry servers. Skillset operations and skill operations use separate API endpoint paths (`/api/skillsets/` vs `/api/skills/`).

The `prepublishOnly` npm hook serves as a safeguard against accidental direct publishing rather than as an active part of the release workflow. It exits with a non-zero status and instructs the user to use the proper release script.

Created and maintained by Nori.
