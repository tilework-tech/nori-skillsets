# Research Notes: First-Class Subagents

## Key Files and Their Roles

### Types and Manifest
- `src/norijson/nori.ts` — `NoriJsonType`, `SkillsetSubagent`, `NoriJsonDependencies`, `addSkillToNoriJson`
- Current `NoriJsonType`: `"skillset" | "skill" | "inlined-skill"` (line 37)
- `SkillsetSubagent` has `id`, `name`, `description` (lines 28-32) — no `scripts` field
- `NoriJsonDependencies.subagents` exists but marked `// future use` (line 44)

### Subagent Loader
- `src/cli/features/shared/subagentsLoader.ts` — `createSubagentsLoader`
- Only handles flat files (`.md` or configured extension)
- Filters by extension, excludes `docs${ext}`, applies template substitution
- Writes to `agent.getSubagentsDir()` (the `agents/` directory)

### Skill Frontmatter Parser
- `src/cli/commands/external/skillDiscovery.ts` — `parseSkillFrontmatter`
- Uses regex, no YAML library. Handles quoted/unquoted values.
- Returns `{ name, description }` or `null`

### Detection
- `src/cli/features/agentOperations.ts:269` — `detectExistingConfig`
- Counts agents as `.md` files in subagents dir (lines 327-338)
- Does NOT detect directory-based subagents

### Upload Flow
- `src/cli/commands/registry-upload/registryUpload.ts`
  - `detectInlineSkillCandidates` (line 154): skills dirs without nori.json
  - `detectExistingInlineSkills` (line 193): skills with `type: "inlined-skill"`
  - `backfillNoriJsonTypes` (line 235): sets missing type on skillset + skill nori.json
  - `createCandidateNoriJsonFiles` (line 300): creates nori.json for candidates
  - `syncLocalStateAfterUpload` (line 335): syncs versions, writes .nori-version
  - `performUpload` (line 740): creates tarball, passes inlineSkills
  - `registryUploadMain` (line 453): orchestrates the full flow

### API
- `src/api/registrar.ts`
  - `UploadSkillsetRequest` has `inlineSkills?: Array<string> | null`
  - `uploadSkillset` sends inlineSkills as form field

### Switch Flow
- `src/cli/commands/switch-skillset/switchSkillset.ts:203`
  - `onReadFileDiff` maps `agents/` -> `subagents/` for flat files only

### Capture Flow
- `src/cli/features/agentOperations.ts:372` — `captureExistingConfig`
  - Copies subagents dir recursively (lines 456-463)
  - Does NOT check for directory-based subagents

## Test Patterns
- Real filesystem with temp dirs (no fs mocking)
- `createTestAgent`, `createTestConfig`, `createTestSkillset` helpers
- Mock `@clack/prompts` and `os.homedir`
- vitest with `describe/it/expect`
- Upload tests use heavy mocking of API modules

## Implementation Approach

This commit implements Tasks 1-6 from the spec:

1. **Type changes** — Add `"subagent" | "inlined-subagent"` to NoriJsonType, add `scripts` to SkillsetSubagent, activate subagents dependency, add `addSubagentToNoriJson`
2. **Frontmatter parsing** — Create `parseSubagentFrontmatter` (same regex pattern as `parseSkillFrontmatter`)
3. **Loader update** — Handle both flat files and directories with SUBAGENT.md
4. **Detection updates** — Count directory-based subagents, add inline detection functions, update backfill
5. **Upload flow updates** — Detect subagent candidates, add inline resolution, pass to API, conflict handling, sync state
6. **Switch and capture updates** — Map agents back to directory-based sources, update capture to preserve directories

## Test Coverage Gaps (identified in follow-up review)

### Real gaps requiring new tests:
1. **Switch flow path mapping** — `onReadFileDiff` in `switchSkillset.ts` maps `agents/foo.md` back to `subagents/foo/SUBAGENT.md` for directory-based subagents. This code path has zero test coverage. Need tests in `switchSkillset.test.ts`.
2. **Loader output messages** — The subagentsLoader logs registered/skipped messages for both flat and directory-based subagents via clack, but no test asserts on these log calls for the directory-based path. Minor.

### Non-gaps (explained by design decisions):
3. **`syncLocalStateAfterUpload` for subagents** — Not implemented because `UploadSkillsetResponse` lacks `extractedSubagents` field. Server-side API is deferred (Task 7). No test needed until server support exists.
4. **`detectExistingConfig` counting subagent dirs** — Spec originally required this, but the "flatten on install" design decision (spec Q1) means the installed `agents/` directory only contains flat files. Directory-based subagents are never present in the installed location, making this requirement moot.

### Key test files for the switch flow:
- `src/cli/commands/switch-skillset/switchSkillset.ts` (lines 203-284) — `onReadFileDiff` implementation
- `src/cli/commands/switch-skillset/switchSkillset.test.ts` — existing test file (no subagent tests yet)

## Test Coverage Parity (Session 2)

### Upload flow subagent tests added (registryUpload.test.ts):
These mirror existing inline skills test patterns:
1. **No subagents directory** — verifies upload succeeds with `inlineSubagents` undefined when no `subagents/` dir
2. **Non-interactive mode** — verifies `inlineSubagents` undefined (extract all) in non-interactive mode
3. **User selects extract** — verifies `inlineSubagents` undefined when user picks "extract" for each subagent
4. **Merge existing + new** — verifies both previously-inlined and newly-inlined subagents appear in `inlineSubagents`

### Loader edge case tests added (subagentsLoader.test.ts):
1. **Null skillset** — loader returns early without error, agents dir not created
2. **Null subagentsDir** — loader returns early without error, agents dir empty

### Test count: 1691 tests (up from 1685)

## Task 7 Research: Server-Side API Now Available (Session 3)

### nori-registrar commit a86602c ("feat: add public API endpoints for subagents (#312)")

The server now supports the full subagent lifecycle. Key API endpoints:

#### Public endpoints (`/api/subagents/`)
- `GET /api/subagents/all` — list all subagents with pagination
- `GET /api/subagents/search?q=...` — search subagents
- `GET /api/subagents/:name` — get subagent packument (same shape as skillset/skill packuments)
- `GET /api/subagents/:name/tarball/:name-:version.tgz` — download tarball
- `GET /api/subagents/:name/dist-tags` — get dist-tags
- `GET /api/subagents/:name/:version` — get version metadata
- `GET /api/subagents/:name/:version/files` — list files
- `GET /api/subagents/:name/maintainers` — list maintainers
- `GET /api/subagents/:name/skillsets` — reverse dependency lookup

#### Authenticated endpoints
- `PUT /api/subagents/:name/subagent` — upload standalone subagent (archive + version + description)
- `PUT /api/subagents/:name/dist-tags/:tag` — set dist-tag
- Maintainer management, vouch status, rename, delete, featured, metadata patch, reingest

#### Skillset upload now handles subagents
- Request accepts `subagentResolutionStrategy` (same shape as `resolutionStrategy` for skills) and `inlineSubagents` (array of IDs)
- Response includes `extractedSubagents: { succeeded: Array<{name, version}>, failed: Array<{name, reason}> }`
- Throws 409 with `SubagentCollisionError` (conflicts array with `subagentId`, `exists`, `canPublish`, `latestVersion`, `owner`, `availableActions`, `contentUnchanged`, `existingSubagentMd`)
- Available resolution actions: `cancel`, `namespace`, `updateVersion`, `link` (same as skills)
- `stampInlinedSubagentTypes` stamps `type: "inlined-subagent"` on nori.json files in tarball
- `updateNoriJsonWithSubagentDependencies` adds `dependencies.subagents` entries

### CLI-side gaps to fill

| Component | Status |
|-----------|--------|
| `SubagentCollisionError` in `fetch.ts` | Missing |
| `SubagentConflict` type in `registrar.ts` | Missing |
| `subagentResolutionStrategy` in `UploadSkillsetRequest` | Missing |
| `extractedSubagents` in `UploadSkillsetResponse` | Missing |
| Collision error handling in upload response (`registrar.ts:494-503`) | Only handles `SkillCollisionError` |
| Subagent collision resolution UI in `upload.ts` | Missing |
| `syncLocalStateAfterUpload` subagent handling | Missing |
| `getSubagentPackument()` API method | Missing |
| `downloadSubagentTarball()` API method | Missing |
| `downloadSubagentDependencies` in registry download | Missing |
| `subagent-download` CLI command | Missing |
| Command name in `cliCommandNames.ts` | Missing |
| Command registration in `noriSkillsetsCommands.ts` | Missing |

### Patterns to mirror

- `SkillCollisionError` (fetch.ts:69-85) → `SubagentCollisionError`
- `getSkillPackument` (registrar.ts:566-594) → `getSubagentPackument`
- `downloadSkillTarball` (registrar.ts:605-650) → `downloadSubagentTarball`
- `downloadSkillDependency/downloadSkillDependencies` (registryDownload.ts:116-273) → `downloadSubagentDependency/downloadSubagentDependencies`
- `skillDownloadMain` (skillDownload.ts:351-853) → `subagentDownloadMain`
- Upload conflict flow (upload.ts) handles both skill and subagent conflicts sequentially
- `syncLocalStateAfterUpload` (registryUpload.ts:489-590) needs subagent dep sync

### Implementation scope for this session (Session 3)

Based on the scope of changes and to keep this PR manageable, we'll split Task 7 into two commits:

**Commit A: Upload completion + API types + subagent dependency download**
1. `SubagentCollisionError` + `SubagentConflictInfo` + `isSubagentCollisionError` in `fetch.ts`
2. `SubagentConflict` + `SubagentResolutionAction/Resolution/Strategy` types in `registrar.ts`
3. `subagentResolutionStrategy` field on `UploadSkillsetRequest`
4. `ExtractedSubagentInfo/Summary` + `extractedSubagents` on `UploadSkillsetResponse`
5. Collision error handling in `uploadSkillset()` for subagent 409s
6. Subagent collision resolution UI in `upload.ts` (after skill conflicts)
7. `syncLocalStateAfterUpload` updated for extracted subagent dependencies
8. `getSubagentPackument()` and `downloadSubagentTarball()` API methods
9. `downloadSubagentDependency/downloadSubagentDependencies` in `registryDownload.ts`
10. Download flow calls `downloadSubagentDependencies` after skill deps

**Commit B: `subagent-download` CLI command (follow-up)**
- Full standalone command mirroring `skill-download`
- Command registration in `cliCommandNames.ts` and `noriSkillsetsCommands.ts`
- Entry in `nori-skillsets.ts`

### Key design decisions for upload collision flow

The server sends skill and subagent collisions as separate 409 responses:
- `SkillCollisionError` has `conflicts` at top level with `skillId` field
- `SubagentCollisionError` has `conflicts` at top level with `subagentId` field
- Differentiator: `code` field — `"SKILL_COLLISION_ERROR"` vs `"SUBAGENT_COLLISION_ERROR"`

The CLI can distinguish them by checking the `code` field in the error response body, OR by checking whether `conflicts[0].skillId` or `conflicts[0].subagentId` exists. The server returns one type of collision at a time (skills first, then subagents after skills are resolved).

**Note on `failed` array shape difference:** Skills use `{ name, error }` in `ExtractedSkillsSummary.failed`, but the server's subagent extraction uses `{ name, reason }`. The CLI type should match the server: `{ name: string; reason: string }`.
