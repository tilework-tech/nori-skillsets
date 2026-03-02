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
| `api/` | HTTP clients for the registry, analytics, transcripts, and authentication token management |
| `norijson/` | Types and runtime operations for the `nori.json` manifest format, plus skillset path utilities, parsing, and discovery |
| `providers/` | External service singletons (Firebase) |
| `scripts/` | Build-time scripts for bundling hook scripts with esbuild |
| `utils/` | Shared helpers for URL normalization, path resolution, proxy/fetch error handling, and home directory detection |

The data flow is top-down: CLI commands orchestrate calls to API clients and features, which in turn use providers and utils. There are no upward dependencies from lower layers.

### Things to Know

The `@/` import alias resolves to this directory, enforced project-wide. All imports use absolute paths from this root rather than relative paths. The `build.test.ts` file at this level validates build output integrity.

Created and maintained by Nori.
