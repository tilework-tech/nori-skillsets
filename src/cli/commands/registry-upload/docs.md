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

1. `detectInlineSkillCandidates` / `detectInlineSubagentCandidates` find subdirectories that lack a `nori.json` file -- these are new items the user hasn't classified yet, presented interactively for inline vs. extract decision. For subagents, only directories containing `SUBAGENT.md` are considered candidates; flat `.md` files are always inlined implicitly.
2. `detectExistingInlineSkills` / `detectExistingInlineSubagents` find subdirectories whose `nori.json` has `type: "inlined-skill"` or `type: "inlined-subagent"` -- these were already inlined on a prior upload and are automatically included without re-prompting.

The `performUpload` helper merges both existing and newly-resolved lists into `allInlineSkills` and `allInlineSubagents` before passing to `registrarApi.uploadSkillset`. This is necessary because `createCandidateNoriJsonFiles` / `createCandidateSubagentNoriJsonFiles` write `nori.json` after the first upload, so on subsequent uploads the candidate detectors no longer find those items. Without the second detection phase, re-uploads would omit the inline parameters entirely, causing the server to treat previously-inlined items as extracted.

**Post-upload sync**: `syncLocalStateAfterUpload` writes the uploaded version and registry URL back to the local `nori.json` and `.nori-version` file, and updates extracted/linked versions for both skills (in `metadata.dependencies.skills`) and subagents (in `metadata.dependencies.subagents`). For each extracted or linked subagent, the function updates both the skillset-level dependency map and the individual subagent's `nori.json` version. This sync is wrapped in try/catch so failures produce a warning but do not mask a successful upload. Dry-run mode skips the sync entirely.

### Things to Know

- The `hasUnifiedAuthWithOrgs` check requires all three: `config.auth`, `config.auth.refreshToken`, and `config.auth.organizations`. If organizations is null (e.g., legacy auth), the unified auth branches are skipped entirely.
- `migrateConfigToAgentsMd` renames `CLAUDE.md` to `AGENTS.md` in the local skillset directory before tarball creation, ensuring uploaded packages always use the current config filename. The migration is a no-op if `AGENTS.md` already exists or if neither file is present.
- `UPLOAD_EXCLUDED_FILES` filters out `.nori-version` from tarballs to prevent distributing local download metadata.
- `createProfileTarball` writes a temp `.tgz` to the parent directory (not inside the skillset dir) and cleans it up in a `finally` block.
- The inline detection pattern is applied symmetrically to both skills and subagents. `detectInlineSkillCandidates` / `detectInlineSubagentCandidates` identify subdirectories lacking `nori.json`, while `detectExistingInlineSkills` / `detectExistingInlineSubagents` find items with `type: "inlined-skill"` or `type: "inlined-subagent"` to preserve inline status across re-uploads. For subagents, only directories containing `SUBAGENT.md` are treated as candidates; flat `.md` files are not surfaced for inline/extract decisions.
- `backfillNoriJsonTypes` now also iterates `subagents/` subdirectories to backfill `type: "subagent"` on existing `nori.json` files that lack a type field.
- The `onReadLocalSubagentMd` callback reads `SUBAGENT.md` from the local subagent directory, enabling diff display during interactive subagent conflict resolution.
- Silent mode bypasses the interactive flow entirely and performs a direct upload without UI.

Created and maintained by Nori.
