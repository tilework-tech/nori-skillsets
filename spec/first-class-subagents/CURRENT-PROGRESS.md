# First-Class Subagents: Current Progress

## Completed Tasks

### Task 1: Type Changes (DONE)
- Added `"subagent" | "inlined-subagent"` to `NoriJsonType`
- Added `scripts` field to `SkillsetSubagent`
- Activated `NoriJsonDependencies.subagents` (removed "future use" comment)
- Added `addSubagentToNoriJson()` function

### Task 2: Subagent Frontmatter Parsing (DONE)
- Created `parseSubagentFrontmatter()` in `src/cli/commands/external/subagentDiscovery.ts`
- Same regex pattern as `parseSkillFrontmatter`

### Task 3: Subagent Loader Update (DONE)
- Updated `createSubagentsLoader` to handle both flat files and directories
- Directory-based subagents (with `SUBAGENT.md`) are flattened on install
- Name collision: directory takes precedence over flat file
- Directories without `SUBAGENT.md` are ignored

### Task 4: Detection Updates (DONE)
- Added `detectInlineSubagentCandidates()` to `registryUpload.ts`
- Added `detectExistingInlineSubagents()` to `registryUpload.ts`
- Updated `backfillNoriJsonTypes()` to handle subagent directories
- Added `createCandidateSubagentNoriJsonFiles()` to `registryUpload.ts`

### Task 5: Upload Flow Updates (DONE)
- Updated `registryUploadMain` to detect subagent candidates alongside skills
- Updated `performUpload` to pass `inlineSubagents` to the API
- Added `inlineSubagents` to `UploadSkillsetRequest` in `registrar.ts`
- Updated `uploadSkillset()` to send `inlineSubagents` as form field
- Updated upload flow UI to accept and resolve subagent candidates
- Updated `UploadFlowCallbacks.onUpload` to accept `inlineSubagentIds`

### Task 6: Switch and Capture Updates (DONE)
- Updated `onReadFileDiff` to check both flat file and directory-based subagent sources
- Updated `captureExistingConfig` to preserve directory-based subagents

### Task 7: Upload Completion + API Methods + Dependency Download (DONE)

#### Error types and type guards (`src/utils/fetch.ts`)
- Added `SubagentResolutionAction`, `SubagentConflictInfo` types
- Added `SubagentCollisionError` class mirroring `SkillCollisionError` with `subagentId` field
- Added `isSubagentCollisionError` type guard

#### API types and methods (`src/api/registrar.ts`)
- Added `SubagentResolutionAction`, `SubagentConflict`, `SubagentResolution`, `SubagentResolutionStrategy` types
- Added `subagentResolutionStrategy` field to `UploadSkillsetRequest`
- Added `ExtractedSubagentInfo`, `ExtractedSubagentsSummary` types (note: failed uses `reason` not `error`)
- Added `extractedSubagents` field to `UploadSkillsetResponse`
- Added `GetSubagentPackumentRequest`, `DownloadSubagentTarballRequest` types
- Added `getSubagentPackument()` API method (hits `/api/subagents/<name>`)
- Added `downloadSubagentTarball()` API method (hits `/api/subagents/<name>/tarball/<name>-<version>.tgz`)
- Re-exported `SubagentCollisionError` and `isSubagentCollisionError` from fetch.ts

#### Upload collision handling (`src/api/registrar.ts`)
- `uploadSkillset()` now sends `subagentResolutionStrategy` as form field
- `uploadSkillset()` detects subagent collision 409 responses (via `subagentConflicts` array) and throws `SubagentCollisionError`

#### Upload flow UI (`src/cli/prompts/flows/upload.ts`)
- `UploadResult` now includes `extractedSubagents` and `subagentConflicts` variants
- `UploadFlowCallbacks.onUpload` accepts `subagentResolutionStrategy`
- `UploadFlowCallbacks` includes `onReadLocalSubagentMd` callback
- `UploadFlowResult` includes `extractedSubagents` and `linkedSubagentVersions`
- Added subagent conflict resolution: auto-resolve unchanged + interactive for modified (same UX as skills)
- Added subagent summary in upload note (extracted + failed)

#### Upload main (`src/cli/commands/registry-upload/registryUpload.ts`)
- `performUpload` handles `isSubagentCollisionError` and returns `subagentConflicts`
- `syncLocalStateAfterUpload` processes `extractedSubagents` — updates `dependencies.subagents` and individual subagent `nori.json` files
- `syncLocalStateAfterUpload` handles `linkedSubagentVersions` for linked (unchanged) subagents
- Added `onReadLocalSubagentMd` callback

#### Subagent dependency download (`src/cli/commands/registry-download/registryDownload.ts`)
- Added `downloadSubagentDependency()` — mirrors `downloadSkillDependency()` with atomic swap, version checking, and .nori-version writing
- Added `downloadSubagentDependencies()` — mirrors `downloadSkillDependencies()`
- Download flow now calls `downloadSubagentDependencies` after skill deps in all 3 locations (main download, and both "already-current" paths)
- Profile update now preserves `subagents/` directory alongside `skills/` during updates

### Test Coverage Gap: Switch Flow Path Mapping (DONE)
- Added 3 tests to `src/cli/commands/switch-skillset/switchSkillset.test.ts` for `onReadFileDiff` callback

### Test Coverage Parity: Upload Flow & Loader Edge Cases (DONE)
- Added 4+4 tests to `registryUpload.test.ts` for inline subagent upload flow
- Added 2 tests to `subagentsLoader.test.ts` for edge cases

### Task 8: `subagent-download` CLI Command (DONE)

#### Command registration
- Added `downloadSubagent: "download-subagent"` to `CommandNames` type and `NORI_SKILLSETS_COMMANDS` in `cliCommandNames.ts`
- Added `registerNoriSkillsetsDownloadSubagentCommand` in `noriSkillsetsCommands.ts`
- Registered command in `nori-skillsets.ts` with usage examples

#### UX flow layer (`src/cli/prompts/flows/subagentDownload.ts`)
- `SubagentSearchResult`, `SubagentDownloadActionResult`, `SubagentDownloadFlowCallbacks`, `SubagentDownloadFlowResult` types
- `subagentDownloadFlow` with three phases: Search → Download → Report
- Mirrors `skillDownloadFlow` with "subagent" terminology
- Re-exported from `flows/index.ts`

#### Business logic (`src/cli/commands/subagent-download/subagentDownload.ts`)
- `subagentDownloadMain` mirrors `skillDownloadMain` with key differences:
  - Downloads tarball, extracts full directory to skillset profile's `subagents/<name>/`
  - Flattens `SUBAGENT.md` content to `agents/<name>.md` for agent installation
  - Updates `nori.json` `dependencies.subagents` via `addSubagentToNoriJson()` (no skills.json equivalent)
  - Broadcasts flattened `.md` to all configured agents
  - Template substitution only on SUBAGENT.md content
- `registerSubagentDownloadCommand` (hidden alias `subagent-download`)
- Registry search, version comparison, namespace support, atomic swap updates

## Deferred Tasks

None — all tasks are complete.

## Test Coverage
- All 1770 unit/integration tests passing
- New test coverage added:
  - `src/utils/fetch.test.ts`: 14 tests for SubagentCollisionError + isSubagentCollisionError
  - `src/api/registrar.test.ts`: 9 tests for subagent API methods + collision handling
  - `src/cli/commands/registry-upload/registryUpload.test.ts`: 4 tests for subagent collision handling + extracted subagents + sync
  - `src/cli/commands/registry-download/registryDownload.test.ts`: 2 tests for subagent dependency download
  - `src/cli/prompts/flows/subagentDownload.test.ts`: 32 tests for subagent download flow UX
  - `src/cli/commands/subagent-download/subagentDownload.test.ts`: 8 tests for subagent download command
