# Noridoc: src

Path: @/src

### Overview

The `src` directory contains all application source code for the nori-skillsets package. It is organized into the CLI application layer, API clients, manifest types, build scripts, external service providers, and shared utilities.

### How it fits into the larger codebase

This is the sole source directory. Everything under `@/src` is compiled to `@/build/src/` during the build process. The CLI entrypoint at `@/src/cli/nori-skillsets.ts` ties together all subdirectories: commands use the API layer for registry operations, the features layer for agent integration, norijson for manifest parsing, and utils for shared helpers.

### Core Implementation

| Directory | Purpose |
|-----------|---------|
| `cli/` | CLI entrypoint, commands, features (agent integrations), prompts, and update checking |
| `core/` | Cli-free policy and orchestration extracted from commands: upload policy/pipeline/sync and org-scoped registry auth resolution (see @/src/core/docs.md) |
| `api/` | HTTP clients for the registry, analytics, transcripts, and authentication token management, plus the pure credential shapes/helpers in `authCredentials.ts` |
| `norijson/` | Types and runtime operations for the `nori.json` manifest format, including metadata CRUD (`readSkillsetMetadata`, `writeSkillsetMetadata`, `addSkillToNoriJson`, `ensureNoriJson`), plus skillset path utilities, parsing, and discovery |
| `packaging/` | Cli-free package mechanics: tarball create/extract, atomic directory replacement, `.nori-version` provenance, and shared registry lookup helpers. Sole owner of these primitives -- commands must not hand-roll them (see @/src/packaging/docs.md) |
| `providers/` | External service singletons (Firebase) |
| `scripts/` | Build-time scripts for bundling hook scripts with esbuild |
| `utils/` | Shared helpers for URL normalization, path resolution, proxy/fetch error handling, and home directory detection |

The data flow is top-down: CLI commands orchestrate calls to core policy modules, API clients, features, and packaging primitives, which in turn use providers and utils. Lower layers do not import from `cli/` -- `core/` and `packaging/` enforce this as an invariant (the one legacy exception is `api/base.ts`, which still reads the config path from `@/cli/config.js`). For the registry-auth slice the direction is `cli/` -> `core/` -> `api/` -> `utils/`.

### Things to Know

The `@/` import alias resolves to this directory, enforced project-wide. All imports use absolute paths from this root rather than relative paths. The `build.test.ts` file at this level validates build output integrity.

Created and maintained by Nori.
