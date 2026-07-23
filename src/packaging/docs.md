# Noridoc: packaging

Path: @/src/packaging

### Overview

- The single owner of package mechanics: tarball creation/extraction, atomic directory replacement, the `.nori-version` provenance sidecar, and shared registry lookup/formatting for the download commands.
- Exists as Layer 2 of the foundation-cleanup spec: every packaging concern gets exactly one implementation. Before this module, each upload/download command carried its own copy-pasted tar pipeline, swap dance, and version-file writer, with subtle drift between copies.
- This module is cli-free: no `@clack/prompts`, no config imports. Callers pass plain values and callbacks (e.g., `fetchPackument`, `getAuthToken`), keeping the dependency direction strictly commands → packaging.

### How it fits into the larger codebase

- Consumed by the five registry-facing commands: @/src/cli/commands/registry-download/registryDownload.ts, @/src/cli/commands/skill-download/skillDownload.ts, @/src/cli/commands/subagent-download/subagentDownload.ts, @/src/cli/commands/registry-upload/registryUpload.ts, and @/src/cli/commands/skill-upload/skillUpload.ts — plus the core upload seams @/src/core/uploadPipeline.ts (`createArchive`, `parseSubagentFrontmatter`) and @/src/core/uploadSync.ts (`writeVersionInfo`).
- `archive.ts` depends on @/src/utils/uploadFileFilter.ts (`shouldExcludeFromUpload`, `collectCargoManifestDirs`) for upload exclusions. It resolves the top-level package source once so a skillset registered through `sks link` remains uploadable, rejects the resolved source when it is at or beneath the filesystem's `.git` entry, then walks an accepted directory with `fs.lstat` and rejects upload-eligible symbolic links below the package root. Literal `.git` files/directories are omitted by the shared filter, while `.gitignore` and distinct authored `.GIT` content on case-sensitive filesystems remain eligible.
- `registryLookup.ts` depends only on types and errors from @/src/api/registrar.js (`Packument`, `NetworkError`, `REGISTRAR_URL`); actual HTTP calls are injected by callers as callbacks.
- Ownership rule: commands must not hand-roll tar pipelines, swap dances, or `.nori-version` reads/writes. New install/update paths go through this module.

### Core Implementation

| File | Owns |
|------|------|
| `archive.ts` | `isGzipped` (magic-byte sniff), `extractArchive` (gzipped or plain tar), `createArchive` (gzipped upload tarball with filtering + interior-symlink rejection), `extractFileFromArchive` (single file from an in-memory tarball) |
| `atomicReplace.ts` | `extractArchiveToNewDir` (fresh install, cleans up on failure), `atomicReplaceDirWithArchive` (whole-directory swap, optional `.nori-version` preservation), `replaceDirContentsWithArchive` (swap that keeps selected top-level entries) |
| `provenance.ts` | `VERSION_FILE` (".nori-version"), `VersionInfo` type (records the resolved `registryUrl` a skillset's bytes came from), `writeVersionInfo` / `readVersionInfo` |
| `registryLookup.ts` | `searchSpecificRegistry` (per-registry packument lookup with injected callbacks), `formatVersionList`, `formatMultipleMatchesError`, `RegistrySearchResult` / `RegistrySearchError` types |
| `subagentDiscovery.ts` | `parseSubagentFrontmatter` (extracts `name`/`description` from `SUBAGENT.md` YAML frontmatter via regex, avoiding a `gray-matter` dependency; mirrors the SKILL.md pattern in @/src/cli/commands/external/skillDiscovery.ts) |

- The atomic swap sequence: extract to a hidden temp sibling, rename target to backup, rename temp into place, delete backup. On any failure the original directory is restored from backup and temp state is removed, so a mid-operation crash never leaves the package half-destroyed.
- `replaceDirContentsWithArchive` exists for skillset updates: the archive's copies of caller-selected preserved entries are discarded and the existing directory's versions are carried into the new contents before the swap. Registry skillset updates use this seam to retain locally-managed `skills/`, `subagents/`, and `.nori-version`. The registry-download command performs its source-authority check before invoking this primitive and refuses an existing target whose resolved path or any ancestor has a `.git` entry; packaging never carries a local repository through a Registrar replacement.
- `searchSpecificRegistry` treats the public registry (no auth) and private registries (auth token via callback) differently: a 404-style API error means "not found" (no error surfaced), while `NetworkError` is reported as a `RegistrySearchError` so callers can distinguish outage from absence. When `getAuthToken` is null, private-registry search silently reports "not found".
- `createArchive` resolves the supplied package root before traversal, so the root itself may be a symlink (including a skillset registered with `sks link`) only when its target is an ordinary package directory. A root whose resolved path is at or beneath a literal `.git` entry, or a case alias that resolves to that entry on a case-insensitive filesystem, is rejected before traversal. Every upload-eligible child is inspected with `fs.lstat`; file, directory, and broken symbolic links below an accepted root fail the upload with the offending relative path instead of being followed or serialized. Literal `.git` entries, filesystem aliases of that entry, and dependency/build output are filtered before validation. The accepted regular-file list is passed explicitly to `node-tar` with `follow: false`, `noDirRecurse: true`, and `strict: true`; each entry is prefixed with `./` so an authored filename beginning with `@` remains a file rather than being interpreted by `node-tar` as an archive to splice. The archive is collected in memory, so packaging does not create or overwrite a sibling temp file. This stable-tree policy does not claim protection against hardlinks or concurrent filesystem retargeting.
- The boundary is relative to the package being archived. Whole-skillset upload rejects a skill linked inside that skillset, while single-skill upload accepts the same directory when it is selected as the package root; links inside that selected skill are still rejected. `registryUploadMain` runs a read-only validation pass before migrations and inline-candidate writes so a rejected whole-skillset upload does not mutate a linked target, then `createArchive` validates again immediately before packing.

### Things to Know

- Two deliberate behavior changes landed with the unification: skillset updates became atomic with restore-on-failure (previously a mid-update crash left the skillset partially destroyed), and failed fresh installs now remove their partial directory instead of leaving debris.
- `readVersionInfo` returns null for missing or malformed files (including a non-string `version`), so callers treat "no provenance" and "corrupt provenance" identically.
- The `.nori-version` sidecar is the authoritative record of where a skillset's bytes came from: its `registryUrl` pins the resolved registry per skillset, the same way a lockfile pins a resolved registry per dependency. Registry downloads write it via `writeVersionInfo` (see @/src/cli/commands/registry-download/docs.md); locally-created skillsets (the `personal/` bucket) have no sidecar. This module no longer owns a "registry-backed vs locally-created" predicate — that decision (and the pinned registry used for re-download-on-switch) now lives in @/src/cli/commands/switch-skillset/switchSkillset.ts's `resolveRedownloadSource`, which reads this sidecar via `readVersionInfo`.
- `extractFileFromArchive` matches entry paths with or without a leading `./` and returns null when the file is absent; @/src/cli/commands/skill-upload/skillUpload.ts uses it to byte-compare the remote `SKILL.md` for client-side conflict detection.
- Tests in this directory exercise real tar/fs round-trips, including failure-restore cases for the swap primitives — they are not mocked.

Created and maintained by Nori.
