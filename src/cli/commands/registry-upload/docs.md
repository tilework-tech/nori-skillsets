# Noridoc: registry-upload

Path: @/src/cli/commands/registry-upload

### Overview

- Uploads skillset packages to the Nori registry as gzipped tarballs
- Handles authorization, version resolution, skill conflict resolution, and post-upload local state sync
- Supports explicit registry URLs, org-scoped uploads, and public registry uploads

### How it fits into the larger codebase

- Registered as `upload` via `@/src/cli/commands/noriSkillsetsCommands.ts` with `wrapWithFraming`
- Uses `@/api/registrar.js` (`registrarApi.uploadSkillset`, `registrarApi.getPackument`) for registry communication
- Auth tokens are obtained via `@/api/registryAuth.js` (`getRegistryAuthToken`) using refresh tokens from config
- Skillset metadata is read/written through `@/norijson/nori.js` (`readSkillsetMetadata`, `writeSkillsetMetadata`)
- Skillset directory paths are resolved via `@/norijson/skillset.js` (`getNoriSkillsetsDir`)
- The interactive upload flow is driven by `uploadFlow` and `listVersionsFlow` from `@/cli/prompts/flows/`
- Namespace parsing uses `parseNamespacedPackage` from `@/utils/url.js`, shared with `registryDownload` and `skillDownload`

### Core Implementation

**Authorization branch order** in `registryUploadMain` determines how the target registry URL and auth token are resolved. The branches are evaluated in this order:

```
1. Explicit registry URL (--registry flag)
   --> Matches auth by comparing URL against org registry URLs, falls back to config-level registry auth

2. Public org + authenticated user (orgId === "public" && hasUnifiedAuthWithOrgs)
   --> Any authenticated user can upload; no org membership check
   --> Server-side moderation (vouchStatus: 'pending') gates non-admin uploads

3. Public org + no auth (orgId === "public")
   --> Error: authentication required

4. Org-scoped + authenticated (hasUnifiedAuthWithOrgs)
   --> Requires userOrgs.includes(orgId) -- org membership enforced

5. No auth configured
   --> Error: login required
```

This branch order mirrors the download commands (`@/src/cli/commands/registry-download/registryDownload.ts`, `@/src/cli/commands/skill-download/skillDownload.ts`) which also handle public separately before org-scoped auth. The key distinction is that the "public" org is not treated as a regular org requiring membership -- it is an open namespace where any authenticated user can publish, with server-side moderation as the gating mechanism.

**Version resolution**: `determineUploadVersion` queries the registry's packument for the latest version and auto-bumps the patch version. Falls back to `1.0.0` for new packages. Explicit versions (from the `@version` suffix in the spec) bypass this logic.

**Upload pipeline**: `registryUploadMain` runs pre-upload migrations (`backfillNoriJsonTypes` for `nori.json` type fields including subagent subdirectory nori.json files, `migrateConfigToAgentsMd` to rename legacy `CLAUDE.md` to `AGENTS.md`), then runs inline detection for both skills and subagents before creating a tarball via `createProfileTarball` and uploading via `registrarApi.uploadSkillset`. Both `SkillCollisionError` and `SubagentCollisionError` are caught and surfaced to the interactive flow for resolution. The `performUpload` helper passes `subagentResolutionStrategy` alongside `resolutionStrategy` to the API, and returns `subagentConflicts` in the `UploadResult` union type.

**Two-phase inline detection** (applied to both skills and subagents): The upload flow distinguishes between new inline candidates and previously-inlined items:

1. `detectInlineSkillCandidates` / `detectInlineSubagentCandidates` find subdirectories that lack a `nori.json` file -- these are new items the user hasn't classified yet, presented interactively for inline vs. extract decision.
2. `detectExistingInlineSkills` / `detectExistingInlineSubagents` find subdirectories whose `nori.json` has `type: "inlined-skill"` or `type: "inlined-subagent"` -- these were already inlined on a prior upload and are automatically included without re-prompting.

The `performUpload` helper merges both existing and newly-resolved lists into `allInlineSkills` and `allInlineSubagents` before passing to `registrarApi.uploadSkillset`. This is necessary because `createCandidateNoriJsonFiles` / `createCandidateSubagentNoriJsonFiles` write `nori.json` after the first upload, so on subsequent uploads the candidate detectors no longer find those items. Without the second detection phase, re-uploads would omit the inline parameters entirely, causing the server to treat previously-inlined items as extracted.

**Flat subagent handling**: In addition to directory-based subagents, the upload flow handles flat `.md` files directly in `subagents/` (e.g., `subagents/foo.md` rather than `subagents/foo/SUBAGENT.md`). `detectFlatSubagentCandidates` scans for `.md` files (excluding `docs.md`) that are not yet recorded in `nori.json.subagents[]` and don't collide with a directory-based subagent of the same name. These candidates are merged into the same interactive inline/extract prompt as directory-based candidates.

The user's decision is persisted differently depending on the choice:
- **Inline**: `persistFlatSubagentInlineChoices` parses frontmatter from the `.md` file (via `parseSubagentFrontmatter` from `@/cli/commands/external/subagentDiscovery.ts`) and adds an entry with `{ id, name, description }` to the skillset's `nori.json.subagents[]` array. On subsequent uploads, the file is recognized as already-declared and skipped by the candidate detector.
- **Extract**: `restructureFlatSubagentsToDirectories` restructures `foo.md` into `foo/SUBAGENT.md`, creates `foo/nori.json` with `type: "subagent"`, and deletes the original flat file. This modifies the user's source tree during upload.

In non-interactive mode, flat subagent candidates are auto-inlined silently. Previously-declared flat inline subagents (those already in `nori.json.subagents[]`) are detected at upload time and merged into `allInlineSubagents` alongside directory-based existing inline subagents.

**Post-upload sync**: `syncLocalStateAfterUpload` writes the uploaded version and registry URL back to the local `nori.json` and `.nori-version` file, and updates extracted/linked versions for both skills (in `metadata.dependencies.skills`) and subagents (in `metadata.dependencies.subagents`). For each extracted or linked subagent, the function updates both the skillset-level dependency map and the individual subagent's `nori.json` version. This sync is wrapped in try/catch so failures produce a warning but do not mask a successful upload. Dry-run mode skips the sync entirely.

**"Use Existing" on diverged content**: When the user resolves a skill conflict with `link` against content that differs from the registry, `uploadFlow` returns that skill in `linkedSkillsToReplace: Map<skillId, string>` (where the string is the canonical `existingSkillMd` the server returned with the conflict). `syncLocalStateAfterUpload` iterates this map and overwrites the local `skills/<id>/SKILL.md` with that content, then also rewrites the skill's `skills/<id>/nori.json` `version` field to match the linked version. Only `SKILL.md` is replaced — sibling files in the skill directory (scripts, READMEs, other nori.json fields) are untouched, because conflict detection and the diff UI both operate at `SKILL.md` granularity. No extra network round-trip is required; the canonical content is reused from the conflict response that was already in memory. If `existingSkillMd` is absent from the conflict, the per-skill replacement is skipped and sync continues. Per-skill write failures are caught and logged via `log.warn` so one skill's sync failure cannot reverse upload success. The mirror path applies to subagents via `linkedSubagentsToReplace` (overwriting `subagents/<id>/SUBAGENT.md`). This closes the loop behind the "Use Existing" UI hint's promise to "discard any local changes" — before this wiring, only the skillset-level dependency version was synced, so the next `sks upload` would re-detect the same conflict.

### Things to Know

- The `hasUnifiedAuthWithOrgs` check requires `config.auth`, `config.auth.organizations`, and either `config.auth.refreshToken` (Firebase session) or `config.auth.apiToken` (non-interactive API-token login). If organizations is null (e.g., legacy auth), the unified auth branches are skipped entirely.
- `migrateConfigToAgentsMd` renames `CLAUDE.md` to `AGENTS.md` in the local skillset directory before tarball creation, ensuring uploaded packages always use the current config filename. The migration is a no-op if `AGENTS.md` already exists or if neither file is present.
- `createProfileTarball` filters tarball entries through the shared `shouldExcludeFromUpload` predicate from `@/src/utils/uploadFileFilter.ts`, which skips local download metadata (`.nori-version`), editor swap/backup files, and OS junk so they cannot pollute the registry's content hash. The same helper is reused by `@/src/cli/commands/skill-upload/skillUpload.ts` so both upload paths share one exclusion list.
- `createProfileTarball` writes a temp `.tgz` to the parent directory (not inside the skillset dir) and cleans it up in a `finally` block.
- The inline detection pattern is applied symmetrically to both skills and subagents. `detectInlineSkillCandidates` / `detectInlineSubagentCandidates` identify subdirectories lacking `nori.json`, while `detectExistingInlineSkills` / `detectExistingInlineSubagents` find items with `type: "inlined-skill"` or `type: "inlined-subagent"` to preserve inline status across re-uploads. Flat `.md` subagent files are handled by a separate detection path (`detectFlatSubagentCandidates`) and merged into the same prompt flow.
- The `nori.json.subagents[]` array serves dual purposes: it stores subagent metadata (name, description) and acts as the persistence mechanism for flat subagent inline decisions. A flat `.md` file whose `id` appears in this array is treated as "already decided" and excluded from re-prompting.
- `restructureFlatSubagentsToDirectories` modifies the user's source tree at upload time -- it creates directories, moves file content, and deletes the original flat file. This is a destructive filesystem operation that happens before tarball creation.
- `backfillNoriJsonTypes` now also iterates `subagents/` subdirectories to backfill `type: "subagent"` on existing `nori.json` files that lack a type field.
- The `onReadLocalSubagentMd` callback reads `SUBAGENT.md` from the local subagent directory, enabling diff display during interactive subagent conflict resolution.
- Silent mode bypasses the interactive flow entirely and performs a direct upload without UI.

Created and maintained by Nori.
