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

## Deferred Tasks

### Task 7: Download Support (DEFERRED - blocked on server-side API)
- `getSubagentPackument()` and `downloadSubagentTarball()` not yet implemented
- `downloadSubagentDependencies()` not yet implemented
- `subagent-download` CLI command not yet created
- Blocked on server-side `/api/subagents/` endpoints

### Test Coverage Gap: Switch Flow Path Mapping (DONE)
- Added 3 tests to `src/cli/commands/switch-skillset/switchSkillset.test.ts` for `onReadFileDiff` callback
- Tests verify directory-based subagent mapping (`agents/foo.md` → `subagents/foo/SUBAGENT.md`)
- Tests verify flat file mapping (`agents/foo.md` → `subagents/foo.md`)
- Tests verify null return when no source exists

## Deferred Tasks

### Task 7: Download Support (DEFERRED - blocked on server-side API)
- `getSubagentPackument()` and `downloadSubagentTarball()` not yet implemented
- `downloadSubagentDependencies()` not yet implemented
- `subagent-download` CLI command not yet created
- Blocked on server-side `/api/subagents/` endpoints

### Test Coverage Parity: Upload Flow & Loader Edge Cases (DONE)
- Added 4 tests to `src/cli/commands/registry-upload/registryUpload.test.ts` for inline subagent upload flow parity:
  - No subagents directory → no `inlineSubagents` sent
  - Non-interactive mode → extract all (no `inlineSubagents`)
  - User selects extract → no `inlineSubagents`
  - Merge existing inlined + new candidates → both in `inlineSubagents`
- Added 2 tests to `src/cli/features/shared/subagentsLoader.test.ts` for edge cases:
  - Null skillset → returns early, agents dir not created
  - Null subagentsDir → returns early, agents dir empty

## Test Coverage
- 33 new tests added across 8 test files
- All 1691 tests passing (up from 1685 prior to this session; 1661 at project start)
- New test file: `src/cli/commands/external/subagentDiscovery.test.ts`
