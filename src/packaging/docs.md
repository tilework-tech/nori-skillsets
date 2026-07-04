# Noridoc: packaging

Path: @/src/packaging

### Overview

- The single owner of package mechanics: tarball creation/extraction, atomic directory replacement, the `.nori-version` provenance sidecar, and shared registry lookup/formatting for the download commands.
- Exists as Layer 2 of the foundation-cleanup spec: every packaging concern gets exactly one implementation. Before this module, each upload/download command carried its own copy-pasted tar pipeline, swap dance, and version-file writer, with subtle drift between copies.
- This module is cli-free: no `@clack/prompts`, no config imports. Callers pass plain values and callbacks (e.g., `fetchPackument`, `getAuthToken`), keeping the dependency direction strictly commands → packaging.

### How it fits into the larger codebase

- Consumed by the five registry-facing commands: @/src/cli/commands/registry-download/registryDownload.ts, @/src/cli/commands/skill-download/skillDownload.ts, @/src/cli/commands/subagent-download/subagentDownload.ts, @/src/cli/commands/registry-upload/registryUpload.ts, and @/src/cli/commands/skill-upload/skillUpload.ts — plus the core upload seams @/src/core/uploadPipeline.ts (`createArchive`, `parseSubagentFrontmatter`) and @/src/core/uploadSync.ts (`writeVersionInfo`).
- `archive.ts` depends on @/src/utils/uploadFileFilter.ts (`shouldExcludeFromUpload`, `collectCargoManifestDirs`) for upload exclusions and @/src/utils/dirent.ts for symlink-following file checks.
- `registryLookup.ts` depends only on types and errors from @/src/api/registrar.js (`Packument`, `NetworkError`, `REGISTRAR_URL`); actual HTTP calls are injected by callers as callbacks.
- Ownership rule: commands must not hand-roll tar pipelines, swap dances, or `.nori-version` reads/writes. New install/update paths go through this module.

### Core Implementation

| File | Owns |
|------|------|
| `archive.ts` | `isGzipped` (magic-byte sniff), `extractArchive` (gzipped or plain tar), `createArchive` (gzipped upload tarball with filtering + symlink following), `extractFileFromArchive` (single file from an in-memory tarball) |
| `atomicReplace.ts` | `extractArchiveToNewDir` (fresh install, cleans up on failure), `atomicReplaceDirWithArchive` (whole-directory swap, optional `.nori-version` preservation), `replaceDirContentsWithArchive` (swap that keeps selected top-level entries) |
| `provenance.ts` | `VERSION_FILE` (".nori-version"), `VersionInfo` type, `writeVersionInfo` / `readVersionInfo` |
| `registryLookup.ts` | `searchSpecificRegistry` (per-registry packument lookup with injected callbacks), `formatVersionList`, `formatMultipleMatchesError`, `RegistrySearchResult` / `RegistrySearchError` types |
| `subagentDiscovery.ts` | `parseSubagentFrontmatter` (extracts `name`/`description` from `SUBAGENT.md` YAML frontmatter via regex, avoiding a `gray-matter` dependency; mirrors the SKILL.md pattern in @/src/cli/commands/external/skillDiscovery.ts) |

- The atomic swap sequence: extract to a hidden temp sibling, rename target to backup, rename temp into place, delete backup. On any failure the original directory is restored from backup and temp state is removed, so a mid-operation crash never leaves the package half-destroyed.
- `replaceDirContentsWithArchive` exists for skillset updates: the archive's copies of preserved entries are discarded and the existing directory's versions (locally-managed `skills/`, `subagents/`, `.nori-version`) are carried into the new contents before the swap.
- `searchSpecificRegistry` treats the public registry (no auth) and private registries (auth token via callback) differently: a 404-style API error means "not found" (no error surfaced), while `NetworkError` is reported as a `RegistrySearchError` so callers can distinguish outage from absence. When `getAuthToken` is null, private-registry search silently reports "not found".
- `createArchive` writes a temp `.tgz` next to (not inside) the source directory, always deletes it in a `finally`, packs with `follow: true` so symlinked skillsets upload real content, and filters entries through the shared upload exclusion predicate.

### Things to Know

- Two deliberate behavior changes landed with the unification: skillset updates became atomic with restore-on-failure (previously a mid-update crash left the skillset partially destroyed), and failed fresh installs now remove their partial directory instead of leaving debris.
- `readVersionInfo` returns null for missing or malformed files (including a non-string `version`), so callers treat "no provenance" and "corrupt provenance" identically.
- `extractFileFromArchive` matches entry paths with or without a leading `./` and returns null when the file is absent; @/src/cli/commands/skill-upload/skillUpload.ts uses it to byte-compare the remote `SKILL.md` for client-side conflict detection.
- Tests in this directory exercise real tar/fs round-trips, including failure-restore cases for the swap primitives — they are not mocked.

Created and maintained by Nori.
