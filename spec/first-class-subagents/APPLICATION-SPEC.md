# First-Class Subagents

**Goal:** Make subagents a first-class citizen on par with skills -- supporting both flat `.md` files (inlined) and directory-based subagents with their own `SUBAGENT.md`, `nori.json`, `README.md`, dependencies, versioning, and independent registry distribution.

**Architecture:** Mirror the existing skills lifecycle for subagents. Today, skills support both inlined files and full directory structures with `SKILL.md`, `nori.json`, scripts, etc. Subagents currently only support flat `.md` files in a `subagents/` directory. This spec promotes subagents to the same level: directory-based subagents with `SUBAGENT.md` as the canonical file (analogous to `SKILL.md`), their own `nori.json` for packaging metadata, and full upload/download/conflict-resolution support.

**Tech Stack:** TypeScript, Node.js, clack/prompts (CLI UI), tar (packaging), semver, diff (diffing)

---

## Current State

### What works today

1. **Flat subagent files**: `subagents/foo.md` is copied to `~/.claude/agents/foo.md` with template substitution
2. **`SkillsetSubagent` type** in `nori.ts` has `id`, `name`, `description` -- but is unused at runtime
3. **`NoriJsonDependencies.subagents`** field exists but is marked "future use"
4. **`NoriJsonType`** is `"skillset" | "skill" | "inlined-skill"` -- no subagent types
5. **`subagentsLoader`** copies `.md` files from `subagents/` to the agent's `agents/` dir, filtering out `docs.md`
6. **Upload flow** handles inline/extract decisions for skills only -- subagents travel opaquely inside the skillset tarball
7. **Capture flow** copies the `agents/` directory back to `subagents/` as a flat copy
8. **Switch flow** maps `agents/*` back to `subagents/*` for change detection

### What's missing

- No support for directory-based subagents (`subagents/foo/SUBAGENT.md`)
- No `nori.json` per subagent (no versioning, no registry presence)
- No inline/extract decision during upload for subagents
- No `subagent-download` command (equivalent to `skill-download`)
- No conflict resolution for subagents during upload
- No `addSubagentToNoriJson` function (equivalent to `addSkillToNoriJson`)
- Detection code in `agentOperations.detectExistingConfig` only counts `.md` files, not directories
- Upload code has no `detectInlineSubagentCandidates` or `detectExistingInlineSubagents`

## Design

### 1. Directory Structure

Subagents support two formats within a skillset:

```
subagents/
  # Format A: Flat file (inlined subagent)
  simple-agent.md

  # Format B: Directory-based subagent
  complex-agent/
    SUBAGENT.md       # Required. Main definition file with YAML frontmatter (name, description)
    nori.json         # Optional. Created on upload. Contains name, version, type
    README.md         # Optional. Human-readable documentation
    .nori-version     # Optional. Created on download. Contains version, registryUrl
    helper-script.sh  # Optional. Bundled scripts
```

**Key file: `SUBAGENT.md`**
- Analogous to `SKILL.md` for skills
- Contains YAML frontmatter with `name` and `description` fields
- Body contains the subagent definition/instructions
- Presence of `SUBAGENT.md` in a directory identifies it as a subagent directory

**`nori.json` for subagents:**
```json
{
  "name": "my-subagent",
  "version": "1.0.0",
  "type": "subagent"
}
```

### 2. Type Changes

#### `NoriJsonType` (in `src/norijson/nori.ts`)

```
Current:  "skillset" | "skill" | "inlined-skill"
Proposed: "skillset" | "skill" | "inlined-skill" | "subagent" | "inlined-subagent"
```

#### `SkillsetSubagent` (in `src/norijson/nori.ts`)

Add an optional `scripts` field to match `SkillsetSkill`:

```typescript
export type SkillsetSubagent = {
  id: string;
  name: string;
  description: string;
  scripts?: Array<string> | null;
};
```

#### `NoriJsonDependencies` (in `src/norijson/nori.ts`)

Activate the `subagents` field (remove "future use" comment):

```typescript
export type NoriJsonDependencies = {
  skills?: Record<string, string> | null;
  subagents?: Record<string, string> | null;  // subagent name -> version range
  slashCommands?: Record<string, string> | null;
};
```

### 3. Subagent Loader Changes (`subagentsLoader.ts`)

The current loader only handles flat `.md` files. It must be updated to handle both formats:

- **Flat `.md` files**: Same as today -- copy with template substitution
- **Directories containing `SUBAGENT.md`**: Copy the entire directory recursively (like `skillsLoader` does for skill directories), applying template substitution to `.md` files. The installed directory name matches the source directory name. The main file installed to the agent's `agents/` directory should be the `SUBAGENT.md` renamed to `<subagent-name>.md` (or the full directory is copied, depending on agent support -- see Q1 below).

**Critical design question**: Claude Code's `agents/` directory expects flat `.md` files. A directory-based subagent in the skillset must be "flattened" during installation -- the `SUBAGENT.md` content is what gets written to `agents/<subagent-name>.md`. The directory structure (nori.json, README, scripts) lives only in the skillset profile, not in the installed agent config.

This means:
- **Source** (skillset profile): `~/.nori/profiles/my-skillset/subagents/complex-agent/SUBAGENT.md`
- **Installed** (agent config): `~/.claude/agents/complex-agent.md` (just the SUBAGENT.md content, template-substituted)

This is different from skills, where the entire directory is copied. The reason is that Claude Code's agent system expects flat markdown files in `agents/`, while skills can be directories.

### 4. Discovery and Parsing

#### `parseSkillset()` in `skillset.ts`

No change needed -- already detects `subagentsDir` presence.

#### New: `parseSubagentFrontmatter()` function

Analogous to `parseSkillFrontmatter()` in `skillDiscovery.ts`. Parses YAML frontmatter from `SUBAGENT.md` files to extract `name` and `description`.

#### Updated: `detectExistingConfig()` in `agentOperations.ts`

Currently counts only `.md` files in the subagents dir (line 327-337). Must also count directories containing `SUBAGENT.md`.

### 5. Upload Flow Changes

#### New detection functions in `registryUpload.ts`

Mirror the existing skill detection functions:

- `detectInlineSubagentCandidates({ skillsetDir })`: Scans `subagents/` for directories without `nori.json`
- `detectExistingInlineSubagents({ skillsetDir })`: Finds subagents with `type: "inlined-subagent"` in their `nori.json`

#### Updated: `backfillNoriJsonTypes()`

Also scan `subagents/` subdirectories and set `type: "subagent"` on any that have a `nori.json` without a type field.

#### Updated: `registryUploadMain()`

After skill inline detection (line 732-737), add subagent inline detection:

```
const subagentInlineCandidates = await detectInlineSubagentCandidates({ skillsetDir });
const existingInlineSubagents = await detectExistingInlineSubagents({ skillsetDir });
```

#### Updated: Upload flow (`upload.ts`)

Add subagent inline resolution phase after skill resolution:
- If `subagentInlineCandidates.length > 0`, prompt the user (batch vs one-by-one, same UX as skills)
- "Keep inline" -> bundled in tarball, `type: "inlined-subagent"` in nori.json
- "Extract as package" -> published independently, `type: "subagent"` in nori.json

#### Updated: `performUpload()`

Pass `inlineSubagents` alongside `inlineSkills` to the API.

#### Updated: API (`registrar.ts`)

The `uploadSkillset()` function needs to send `inlineSubagents` as an additional form field, similar to `inlineSkills`.

#### Updated: Conflict resolution

If the server returns subagent conflicts (new conflict type), handle them the same way as skill conflicts -- auto-resolve unchanged content, prompt for manual resolution with Update Version / Namespace / Use Existing / View Diff options.

The diff display for subagents reads `SUBAGENT.md` (analogous to `SKILL.md` for skills).

#### Updated: `syncLocalStateAfterUpload()`

Also sync extracted subagent versions to `metadata.dependencies.subagents` and update individual subagent `nori.json` files.

### 6. Download Flow

#### New: `subagent-download` command

Mirror `skill-download` command structure:

- `sks subagent-download <subagent-name>` or `sks subagent-download <subagent-name>@<version>`
- Searches registries for the subagent packument
- Downloads tarball and extracts to the skillset's `subagents/<subagent-name>/` directory
- Writes `.nori-version` with version and registry URL
- Installs to the primary agent's `agents/` directory (flattened: SUBAGENT.md -> agents/<name>.md)
- Broadcasts to all configured agents
- Updates `nori.json` dependencies.subagents via new `addSubagentToNoriJson()`

#### New: `addSubagentToNoriJson()` in `nori.ts`

Analogous to `addSkillToNoriJson()`:

```typescript
export const addSubagentToNoriJson = async (args: {
  skillsetDir: string;
  subagentName: string;
  version: string;
}): Promise<void> => { ... };
```

#### Updated: `registryDownloadMain()` -- skill dependencies

After downloading skill dependencies, also download subagent dependencies from `nori.json.dependencies.subagents`.

### 7. Registry API Changes

#### New API endpoints (server-side, out of scope for this CLI repo)

- `GET /api/subagents/<name>` -- get subagent packument
- `GET /api/subagents/<name>/tarball/<name>-<version>.tgz` -- download subagent tarball
- Upload: server extracts subagent directories from skillset tarballs similar to skills

#### New client functions in `registrar.ts`

- `getSubagentPackument({ packageName, registryUrl, authToken? })`
- `downloadSubagentTarball({ packageName, version?, registryUrl, authToken? })`

These mirror `getSkillPackument` and `downloadSkillTarball`.

### 8. Switch Skillset Changes

#### Updated: `onReadFileDiff` in `switchSkillset.ts`

Currently maps `agents/` -> `subagents/` for flat files (line 232-237). Must also handle the case where the source is a directory-based subagent:

- `agents/foo.md` -> check `subagents/foo.md` first; if not found, check `subagents/foo/SUBAGENT.md`

### 9. Capture Flow Changes

#### Updated: `captureExistingConfig()` in `agentOperations.ts`

Currently copies the `agents/` directory flat. Since installed agents are always flat `.md` files (even directory-based subagents are flattened), capture creates flat `.md` files in `subagents/`. This is correct -- capture cannot reconstruct the directory structure.

However, if a directory-based subagent already exists in the skillset's `subagents/` dir, we should not overwrite the directory with a flat file. We should update the `SUBAGENT.md` content within the existing directory instead.

### 10. Backwards Compatibility

#### Flat files remain supported

The system MUST continue to support `subagents/foo.md` format indefinitely. Users who have existing flat subagent files should see zero behavior change.

#### Detection heuristic

A directory in `subagents/` is a subagent directory if and only if it contains a `SUBAGENT.md` file. Directories without `SUBAGENT.md` are ignored (same pattern as skills requiring `SKILL.md`).

#### Flat files become "inlined" during upload

Flat `.md` files in `subagents/` that are NOT in a directory are always treated as inlined subagents during upload. They are bundled in the tarball without any inline/extract prompt.

Only directory-based subagents (those with `SUBAGENT.md`) get the inline/extract decision.

### 11. `looksLikeSkillset()` heuristic

Currently checks for the presence of both `skills/` and `subagents/`. No change needed -- this already works with the new directory format.

### 12. Instructions Loader

Currently `generateSkillsList()` only lists skills. Should it also list subagents?

**Recommendation**: No. Subagents are already listed separately by the `subagentsLoader` in a "Subagents" note box. The instructions loader's skill listing serves a different purpose -- it tells the AI agent what skills are available. Subagents are discovered differently by agents (they're separate processes, not inline instructions).

---

## Edge Cases

1. **Mixed formats**: A `subagents/` directory can contain both flat `.md` files and subdirectories with `SUBAGENT.md`. Both must be handled.

2. **Name collision between flat file and directory**: `subagents/foo.md` AND `subagents/foo/SUBAGENT.md` -- the directory takes precedence. The flat file is ignored with a warning.

3. **Directory without `SUBAGENT.md`**: Ignored. Only directories containing `SUBAGENT.md` are recognized as subagent packages. This matches how skills require `SKILL.md`.

4. **Agent file extension differences**: Codex uses `.toml`, not `.md`. For directory-based subagents, the `SUBAGENT.md` content is still the canonical source, but the installed file uses the agent's preferred extension (e.g., `agents/foo.toml` for Codex). Template substitution is applied regardless. **Question**: Does Codex's `.toml` format require actual TOML syntax, or is it just a renamed markdown file? This affects whether we need a format conversion step.

5. **Existing subagents without directories on re-upload**: If a user has flat `subagents/foo.md` and uploads, `foo` is always inlined. On the next upload, if they've converted `foo` to a directory (`subagents/foo/SUBAGENT.md`), it should be detected as a new inline candidate (no nori.json) and prompted.

6. **Template variables in SUBAGENT.md**: Same template substitution applies (`{{skills_dir}}`, `{{profiles_dir}}`, `{{commands_dir}}`, `{{install_dir}}`). No changes needed.

7. **`docs.md` exclusion**: Currently the subagents loader excludes `docs.md` from flat file processing. For directory-based subagents, `docs.md` inside a subagent directory should NOT be excluded -- it's part of the subagent package. The exclusion only applies to `subagents/docs.md` at the top level.

8. **Upload tarball size**: Directory-based subagents with scripts could increase tarball sizes. Same concern as skills -- no special handling needed.

9. **Subagent dependencies on skills or other subagents**: The `nori.json` within a subagent directory could declare dependencies. Initially, we should NOT support nested dependencies within subagents. A subagent's `nori.json` tracks name, version, type, and optional metadata only. Dependencies are managed at the skillset level.

10. **Registry namespace collisions**: A skill named "foo" and a subagent named "foo" are in different registries (`/api/skills/foo` vs `/api/subagents/foo`), so they don't collide. However, this should be documented clearly.

---

## Resolved Questions

**Q1: Installed subagent format -- flat or directory?**
**DECIDED: Flatten.** Install only the `SUBAGENT.md` content as `agents/<name>.md` (or `agents/<name>.toml` for Codex). The directory structure (nori.json, README, scripts) is for internal nori use only, not installed to the agent config.

**Q2: Codex TOML format**
**DECIDED: Conversion step needed.** Codex requires actual TOML syntax. The agent-specific loader must convert markdown to TOML format when installing directory-based subagents.

**Q3: Server-side API for subagents**
**DECIDED: Deferred.** Server-side `/api/subagents/` endpoints are being added soon. Client-side download support (`subagent-download` command, `downloadSubagentDependencies`) will be a follow-up PR.

**Q4: Should flat `.md` subagent files get the inline/extract prompt during upload?**
**DECIDED: No.** Flat `.md` subagent files are always inlined. Only directory-based subagents (with `SUBAGENT.md`) get the prompt. Matches skills behavior.

**Q5: Subagent frontmatter validation**
**DECIDED: Yes.** Match skills behavior. `SUBAGENT.md` must have `name` and `description` in frontmatter.

---

## Testing Plan

### Integration tests: subagentsLoader

- Test that the loader handles a mixed `subagents/` directory containing both flat `.md` files and subdirectories with `SUBAGENT.md`
- Test that directory-based subagents are flattened: only `SUBAGENT.md` content (with template substitution) is written to the agent's `agents/` directory
- Test that flat `.md` files continue to work exactly as before (backwards compat)
- Test name collision between `foo.md` and `foo/SUBAGENT.md` -- directory wins
- Test that directories without `SUBAGENT.md` are ignored
- Test that `docs.md` at the top level is still excluded but `docs.md` inside a subagent directory is not affected
- Test the registered/skipped output for both formats

### Integration tests: upload flow

- Test `detectInlineSubagentCandidates` finds directories without `nori.json`
- Test `detectExistingInlineSubagents` finds directories with `type: "inlined-subagent"` in nori.json
- Test `backfillNoriJsonTypes` sets `type: "subagent"` on subagent directory nori.json files
- Test that flat `.md` subagents are always inlined (no prompt)
- Test that directory-based subagent candidates trigger the inline/extract prompt
- Test `createCandidateNoriJsonFiles` creates nori.json for subagent candidates
- Test `syncLocalStateAfterUpload` syncs extracted subagent versions to `dependencies.subagents`

### Integration tests: nori.json operations

- Test `addSubagentToNoriJson` correctly adds/updates `dependencies.subagents`
- Test `addSubagentToNoriJson` creates nori.json if it doesn't exist

### Integration tests: detection and switch

- Test `detectExistingConfig` counts both flat files and directories with SUBAGENT.md
- Test switch flow maps `agents/foo.md` back to either `subagents/foo.md` or `subagents/foo/SUBAGENT.md`

### Unit tests: frontmatter parsing

- Test `parseSubagentFrontmatter` extracts name and description from SUBAGENT.md
- Test missing frontmatter returns sensible defaults

NOTE: I will write *all* tests before I add any implementation behavior.

---

## Implementation Tasks (ordered)

### Task 1: Type changes
- Add `"subagent" | "inlined-subagent"` to `NoriJsonType`
- Add `scripts` field to `SkillsetSubagent`
- Activate `NoriJsonDependencies.subagents` (remove "future use" comment)
- Add `addSubagentToNoriJson()` function

### Task 2: Subagent frontmatter parsing
- Create `parseSubagentFrontmatter()` (can live in a new file or alongside skill discovery)

### Task 3: Subagent loader update
- Update `createSubagentsLoader` to handle both flat files and directories
- Flatten directory-based subagents to single `.md` file on install

### Task 4: Detection updates
- Update `detectExistingConfig` in `agentOperations.ts` to count directory-based subagents
- Add `detectInlineSubagentCandidates()` and `detectExistingInlineSubagents()` to `registryUpload.ts`
- Update `backfillNoriJsonTypes()` to handle subagent directories

### Task 5: Upload flow updates
- Detect subagent candidates in `registryUploadMain`
- Add subagent inline resolution in upload flow
- Pass `inlineSubagents` to API
- Add subagent conflict resolution (same UX as skills)
- Update `syncLocalStateAfterUpload` for subagent dependencies
- Update `createCandidateNoriJsonFiles` to also handle subagent candidates

### Task 6: Switch and capture updates
- Update `onReadFileDiff` to check directory-based subagent sources
- Update `captureExistingConfig` to not overwrite directory-based subagents with flat files

### Task 7: Download support (DEFERRED -- follow-up PR)
- Add `getSubagentPackument()` and `downloadSubagentTarball()` to registrar API
- Add `downloadSubagentDependencies()` to registry download flow
- Create `subagent-download` command (mirror `skill-download`)
- Register `subagent-download` command in CLI
- Blocked on server-side `/api/subagents/` endpoints

---

**Testing Details:** Tests cover the core behavioral boundaries: loader handles mixed formats and flattens correctly, upload detects candidates and prompts correctly, download writes dependencies, detection counts both formats, and switch maps paths correctly. All tests focus on observable behavior (files written, prompts triggered, counts returned), not implementation internals.

**Implementation Details:**
- Subagents gain parity with skills for directory structure, nori.json, upload/versioning
- Flat `.md` subagent files remain fully supported (backwards compatible)
- `SUBAGENT.md` is the canonical marker for directory-based subagents (like `SKILL.md` for skills)
- Directory-based subagents are flattened to single files during agent installation
- Upload flow gains subagent inline/extract decisions, conflict resolution, and diff viewing
- Codex `.toml` agents require a format conversion step during installation
- Download support (`subagent-download`, registry API client) deferred to follow-up PR

**Deferred to follow-up PRs:**
- `subagent-download` command and registry API client functions (blocked on server endpoints)
- `downloadSubagentDependencies` in registry download flow

---
