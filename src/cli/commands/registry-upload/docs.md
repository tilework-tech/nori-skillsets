# Noridoc: registry-upload

Path: @/src/cli/commands/registry-upload

### Overview

- Uploads skillset packages to the Nori registry as gzipped tarballs
- Handles authorization, version resolution, skill conflict resolution, and post-upload local state sync
- Supports explicit registry URLs, org-scoped uploads, and explicit public registry uploads (via `--public`)

### How it fits into the larger codebase

- Exposed as `sks upload` / `nori-skillsets upload` via `@/src/cli/commands/noriSkillsetsCommands.ts`, which owns Commander registration and wraps this module's `registryUploadMain` with `wrapWithFraming`
- Uses `@/api/registrar.js` (`registrarApi.uploadSkillset`, `registrarApi.getPackument`) for registry communication
- Auth tokens are obtained via `@/api/registryAuth.js` (`getRegistryAuthToken`) using refresh tokens, broker-managed direct ID tokens, saved API tokens, or a matching `NORI_API_TOKEN`; credential predicates (`hasRegistryAuthCredentials`, `toRegistryAuth`) come from @/src/api/authCredentials.ts, and the org-scoped membership/URL/auth resolution is shared with the download commands via `resolveOrgRegistryAuth` from @/src/core/registryAuthResolution.ts
- Skillset metadata is read/written through `@/norijson/nori.js` (`readSkillsetMetadata`, `writeSkillsetMetadata`)
- The local skillset *source* is located via `resolveSkillsetDir` from `@/norijson/skillset.js`, using **bucket precedence for a public package**: a public target is looked up by its bare `packageName` (so `resolveSkillsetDir` walks `personal/` -> `public/` -> legacy flat), while an org target is looked up at its `<org>/<name>` namespace. This lets a locally-created `personal/` or legacy-flat skillset still be published to public. The source lookup is deliberately separate from the registry *target*, which is derived from the parsed namespace and displayed fully qualified via `namespacedName` (public = `public/<name>`); a name that resolves nowhere fails with "Skillset not found" (see the storage-bucket model in @/src/norijson/docs.md)
- The interactive upload flow is driven by `uploadFlow` and `listVersionsFlow` from `@/cli/prompts/flows/`
- Namespace parsing uses `parseNamespacedPackage` from `@/utils/url.js`, shared with `registryDownload` and `skillDownload`

### Core Implementation

**Authorization branch order** in `registryUploadMain` determines how the target registry URL and auth token are resolved. The branches are evaluated in this order:

```
1. Explicit registry URL (--registry flag)
   --> Matches auth by comparing URL against org registry URLs, falls back to config-level registry auth

2. Public org + authenticated user or matching env API token
   --> Any authenticated user can upload; no org membership check
   --> Server-side moderation (vouchStatus: 'pending') gates non-admin uploads

3. Public org + no auth (orgId === "public")
   --> Error: authentication required

4. Org-scoped + authenticated user or matching env API token
   --> Membership check, registry URL, and RegistryAuth come from
       resolveOrgRegistryAuth (@/src/core/registryAuthResolution.ts);
       a NORI_API_TOKEN embedding the target org bypasses the membership check

5. No auth configured
   --> Error: login required
```

For a mutating upload, local source resolution and the Git source-authority
preflight run before this authorization branch, public-upload confirmation, or
token acquisition. This keeps a Git-governed source entirely on the Git
lifecycle even when Registrar credentials are absent or stale. `--list-versions`
and `--dry-run` retain their existing read-only/non-publishing paths and do not
run this preflight.

This branch order mirrors the download commands (`@/src/cli/commands/registry-download/registryDownload.ts`, `@/src/cli/commands/skill-download/skillDownload.ts`) which also handle public separately before org-scoped auth. The key distinction is that the "public" org is not treated as a regular org requiring membership -- it is an open namespace where any authenticated user can publish, with server-side moderation as the gating mechanism.

**Version resolution**: `determineUploadVersion` queries the registry's packument for the latest version and auto-bumps the patch version. Falls back to `1.0.0` for new packages. Explicit versions (from the `@version` suffix in the spec) bypass this logic.

**Upload pipeline**: After resolving the local source, a mutating upload passes the skillset directory to the shared Git source-authority check in @/src/cli/features/gitSourceAuthority.ts. A `.git` entry at the resolved source or any real-path ancestor refuses the Registrar upload before migrations, inline detection, or other local writes; Git-governed skillsets must publish through Git. The read-only `--list-versions` and non-mutating `--dry-run` paths remain available. Eligible Registrar uploads run pre-upload migrations (`backfillNoriJsonTypes` for `nori.json` type fields including subagent subdirectory nori.json files, `migrateConfigToAgentsMd` to rename legacy `CLAUDE.md` to `AGENTS.md`), then run inline detection for both skills and subagents. The packaging-and-upload seam itself lives in `performSkillsetUpload` in `@/src/core/uploadPipeline.ts`: candidate `nori.json` creation, flat-subagent partitioning, tarball creation via `createArchive` from @/src/packaging/archive.ts, and the `registrarApi.uploadSkillset` call. Both `SkillCollisionError` and `SubagentCollisionError` are caught there and mapped into the `UploadResult` union (`conflicts` / `subagentConflicts`), which the command surfaces to the interactive flow for resolution. The command binds its packaging context (candidate lists, auth, registry URL) onto `performSkillsetUpload` in a local `performUpload` helper so the silent path and the interactive flow's `onUpload` callback drive the same core function. The public `upload` command exposes `--resolve <strategy>` for non-interactive conflict handling; the Commander option is registered in `noriSkillsetsCommands.ts` and passed through to `registryUploadMain`, where it is validated before reaching `uploadFlow`. In non-interactive mode, `--resolve updateVersion` builds explicit per-skill and per-subagent version bumps from the registry conflict's `latestVersion` before retrying, because the registrar requires a version on each `updateVersion` action. A null upload-flow result is treated as cancellation only for interactive uploads; non-interactive upload failures return a non-cancelled failure so `wrapWithFraming({ exitOnFailure: true })` exits non-zero in CI.

**Two-phase inline detection** (applied to both skills and subagents): The upload flow distinguishes between new inline candidates and previously-inlined items:

1. `detectInlineSkillCandidates` / `detectInlineSubagentCandidates` find subdirectories that lack a `nori.json` file -- these are new items the user hasn't classified yet, presented interactively for inline vs. extract decision.
2. `detectExistingInlineSkills` / `detectExistingInlineSubagents` find subdirectories whose `nori.json` has `type: "inlined-skill"` or `type: "inlined-subagent"` -- these were already inlined on a prior upload and are automatically included without re-prompting.

`performSkillsetUpload` merges both existing and newly-resolved lists into `allInlineSkills` and `allInlineSubagents` before passing to `registrarApi.uploadSkillset`. This is necessary because `createCandidateNoriJsonFiles` / `createCandidateSubagentNoriJsonFiles` (module-private in `@/src/core/uploadPipeline.ts`) write `nori.json` after the first upload, so on subsequent uploads the candidate detectors no longer find those items. Without the second detection phase, re-uploads would omit the inline parameters entirely, causing the server to treat previously-inlined items as extracted.

**Flat subagent handling**: In addition to directory-based subagents, the upload flow handles flat `.md` files directly in `subagents/` (e.g., `subagents/foo.md` rather than `subagents/foo/SUBAGENT.md`). `detectFlatSubagentCandidates` scans for `.md` files (excluding `docs.md`) that are not yet recorded in `nori.json.subagents[]` and don't collide with a directory-based subagent of the same name. These candidates are merged into the same interactive inline/extract prompt as directory-based candidates.

The user's decision is persisted differently depending on the choice:
- **Inline**: `persistFlatSubagentInlineChoices` (exported from `@/src/core/uploadPipeline.ts`, also called directly by the command for the non-interactive auto-inline path) parses frontmatter from the `.md` file (via `parseSubagentFrontmatter` from `@/src/packaging/subagentDiscovery.ts`) and adds an entry with `{ id, name, description }` to the skillset's `nori.json.subagents[]` array. On subsequent uploads, the file is recognized as already-declared and skipped by the candidate detector.
- **Extract**: `restructureFlatSubagentsToDirectories` (module-private in `@/src/core/uploadPipeline.ts`) restructures `foo.md` into `foo/SUBAGENT.md`, creates `foo/nori.json` with `type: "subagent"`, and deletes the original flat file. This modifies the user's source tree during upload.

In non-interactive mode, flat subagent candidates are auto-inlined silently. Previously-declared flat inline subagents (those already in `nori.json.subagents[]`) are detected at upload time and merged into `allInlineSubagents` alongside directory-based existing inline subagents.

**Post-upload sync**: `syncLocalStateAfterUpload` (in `@/src/core/uploadSync.ts`) writes the uploaded version and registry URL back to the local `nori.json` and `.nori-version` file (via `writeVersionInfo` from @/src/packaging/provenance.ts), and updates extracted/linked versions for both skills (in `metadata.dependencies.skills`) and subagents (in `metadata.dependencies.subagents`). For each extracted or linked subagent, the function updates both the skillset-level dependency map and the individual subagent's `nori.json` version. The command's `trySyncLocalState` wrapper wraps the call in try/catch and prints the returned warnings via `log.warn`, so sync failures produce a warning but do not mask a successful upload. Dry-run mode skips the sync entirely.

**"Use Existing" on diverged content**: When the user resolves a skill conflict with `link` against content that differs from the registry, `uploadFlow` returns that skill in `linkedSkillsToReplace: Map<skillId, string>` (where the string is the canonical `existingSkillMd` the server returned with the conflict). `syncLocalStateAfterUpload` iterates this map and overwrites the local `skills/<id>/SKILL.md` with that content, then also rewrites the skill's `skills/<id>/nori.json` `version` field to match the linked version. Only `SKILL.md` is replaced — sibling files in the skill directory (scripts, READMEs, other nori.json fields) are untouched, because conflict detection and the diff UI both operate at `SKILL.md` granularity. No extra network round-trip is required; the canonical content is reused from the conflict response that was already in memory. If `existingSkillMd` is absent from the conflict, the per-skill replacement is skipped and sync continues. Per-skill write failures are caught and returned as warnings (printed by the command via `log.warn`) so one skill's sync failure cannot reverse upload success. The mirror path applies to subagents via `linkedSubagentsToReplace` (overwriting `subagents/<id>/SUBAGENT.md`). This closes the loop behind the "Use Existing" UI hint's promise to "discard any local changes" — before this wiring, only the skillset-level dependency version was synced, so the next `sks upload` would re-detect the same conflict.

### Things to Know

- **Public-upload guard**: After the source-authority preflight and before resolving auth, `registryUploadMain` calls `guardPublicUpload` from `@/src/cli/commands/publicUploadGuard.ts` (shared with `skill-upload`) so publishing to the public registry must be **explicit**. A target is explicitly public only when `--public` is passed, the spec is namespaced `public/<skillset>`, or `--registry <url>` is passed; a bare, non-namespaced skillset name defaults to the public apex and trips the guard **only when no `defaultOrg` is configured**. `registryUploadMain` loads config before parsing and passes `config.defaultOrg` into `parseNamespacedPackage` unless `--public` or `--registry` is present, so a bare `upload <name>` with a configured `defaultOrg` resolves to that org (via `formatDefaultOrgNotice`-visible redirect) and targets the org registry instead of tripping the public guard; excluding `defaultOrg` under `--public`/`--registry` also means `--public` never falsely trips the "cannot combine --public with the `<org>/` namespace" guard. When tripped in silent/non-interactive mode the command fails with guidance ("Refusing to publish ... Re-run with one of: `--public` / `<org>/<name>` / `--registry <url>`"); interactively it shows a clack confirm defaulting to No and cancels on decline. Contradictory targets error out (`--public` with `--registry`, or `--public` with an `<org>/` namespace). Read-only operations (`--list-versions`, `--dry-run`) never publish and are exempt from the guard. This is the root-cause fix for a real incident where an org-intended package was silently published to `noriskillsets.dev`. The `--public` flag is registered in `noriSkillsetsCommands.ts` and threaded through as `publicRegistry`. Because subagents have no standalone upload command (they publish only as part of a skillset upload), gating `upload` also covers them.
- **Source-authority guard**: Registrar uploads are refused when the resolved skillset source or any real-path ancestor contains a `.git` entry. For mutating uploads the source is resolved and checked before public-upload confirmation, authentication/token acquisition, upload-time migrations, or candidate processing. It is shared with Registrar download and single-skill upload, so a source is governed by one lifecycle rather than being partly updated through Git and partly published through Registrar. `--list-versions` and `--dry-run` are exempt because they do not mutate or publish the source.
- The `hasUnifiedAuthWithOrgs` check requires `config.auth`, `config.auth.organizations`, and one usable token source: `config.auth.refreshToken` (Firebase session), an unexpired `config.auth.idToken` (broker-managed session machine), or `config.auth.apiToken` (non-interactive API-token login). If organizations is null (e.g., legacy auth), the unified auth branches are skipped entirely. A matching `NORI_API_TOKEN` can still authorize upload with no saved config; the command builds a registry auth request for the target URL and lets `getRegistryAuthToken` enforce token-to-registry scoping.
- `migrateConfigToAgentsMd` renames `CLAUDE.md` to `AGENTS.md` in the local skillset directory before tarball creation, ensuring uploaded packages always use the current config filename. The migration is a no-op if `AGENTS.md` already exists or if neither file is present.
- Tarball creation is delegated to `createArchive` from @/src/packaging/archive.ts, which filters entries through the shared `shouldExcludeFromUpload` predicate from `@/src/utils/uploadFileFilter.ts` (skipping `.nori-version`, editor/OS junk, and dependency/build "bloat" directories, with Cargo-adjacent `target/` detection via `collectCargoManifestDirs`), packs with `follow: true` so symlinked content uploads as real files, and writes/cleans up its temp `.tgz` next to the source directory. The same primitive is used by `@/src/cli/commands/skill-upload/skillUpload.ts`, so both upload paths share one exclusion list. See @/src/packaging/docs.md.
- All directory-entry type checks throughout the upload flow use `isDirentDirectory()` from `@/src/utils/dirent.ts` instead of raw `entry.isDirectory()`, so that symlinked subdirectories (e.g., symlinked `skills/` or `subagents/` entries) are correctly detected. This applies to inline candidate detection, existing inline detection, backfill, and flat subagent scanning.
- The inline detection pattern is applied symmetrically to both skills and subagents. `detectInlineSkillCandidates` / `detectInlineSubagentCandidates` identify subdirectories lacking `nori.json`, while `detectExistingInlineSkills` / `detectExistingInlineSubagents` find items with `type: "inlined-skill"` or `type: "inlined-subagent"` to preserve inline status across re-uploads. Flat `.md` subagent files are handled by a separate detection path (`detectFlatSubagentCandidates`) and merged into the same prompt flow.
- The `nori.json.subagents[]` array serves dual purposes: it stores subagent metadata (name, description) and acts as the persistence mechanism for flat subagent inline decisions. A flat `.md` file whose `id` appears in this array is treated as "already decided" and excluded from re-prompting.
- `restructureFlatSubagentsToDirectories` modifies the user's source tree at upload time -- it creates directories, moves file content, and deletes the original flat file. This is a destructive filesystem operation that happens before tarball creation.
- `backfillNoriJsonTypes` now also iterates `subagents/` subdirectories to backfill `type: "subagent"` on existing `nori.json` files that lack a type field.
- The `onReadLocalSubagentMd` callback reads `SUBAGENT.md` from the local subagent directory, enabling diff display during interactive subagent conflict resolution.
- Commander registration for upload options intentionally lives in `noriSkillsetsCommands.ts`; this module owns upload behavior, not a separate public `registry-upload` subcommand.
- Silent mode bypasses the interactive flow entirely and performs a direct upload without UI.

Created and maintained by Nori.
