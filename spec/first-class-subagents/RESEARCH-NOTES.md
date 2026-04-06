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
