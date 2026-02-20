# Current Progress

## Completed

### Commit 1: Extract agent-agnostic code from claude-code directory

**Refactor A progress:** Moved agent-agnostic utilities out of `src/cli/features/claude-code/` into shared `src/cli/features/` locations. Added `getAgentDir` to the Agent interface.

Changes:
- Created `src/cli/features/paths.ts` with `getNoriDir()` and `getNoriSkillsetsDir()` (moved from `claude-code/paths.ts`)
- Created `src/cli/features/skillsetMetadata.ts` with `readSkillsetMetadata`, `writeSkillsetMetadata`, `addSkillToNoriJson`, `ensureNoriJson` (moved from `claude-code/skillsets/metadata.ts`, old file deleted)
- Created `src/cli/features/template.ts` with `substituteTemplatePaths` (moved from `claude-code/template.ts`, old file deleted)
- Added `getAgentDir({ installDir })` to the `Agent` interface in `agentRegistry.ts`
- Implemented `getAgentDir` on the claude-code agent (returns `<installDir>/.claude`)
- Updated 15+ command files and internal feature files to import from new shared locations
- Updated all test mocks to cover the new module paths
- Moved test files for metadata and template to new shared locations
- Updated 6 docs.md files

### Commit 2: Replace hardcoded claude-code references in CLI commands

**Refactor A progress:** CLI commands no longer import claude-code-specific paths directly. They use the Agent interface from `agentRegistry.ts` instead.

Changes:
- Added `AgentArtifact` type, `getSkillsDir()`, `getProjectsDir?()`, `findArtifacts?()` to Agent interface in `agentRegistry.ts`
- Renamed `ExistingConfig.hasClaudeMd` → `hasConfigFile` (agent-agnostic name)
- Implemented new methods on claude-code agent (`agent.ts`)
- Relocated `manifest.ts` from `claude-code/skillsets/manifest.ts` to `src/cli/features/manifest.ts` (renamed `claudeDir` param to `agentDir` in `removeManagedFiles`)
- Relocated `skillResolver.ts` from `claude-code/skillsets/skills/resolver.ts` to `src/cli/features/skillResolver.ts`
- Deleted old `manifest.ts` and `resolver.ts` source files
- Updated 7 CLI commands to use agent interface methods instead of hardcoded paths:
  - `config.ts`, `switchSkillset.ts`, `install.ts` → `agent.getAgentDir()` + shared manifest
  - `external.ts`, `skillDownload.ts` → `agent.getSkillsDir()` + shared resolver
  - `factoryReset.ts` → `agent.findArtifacts()`
  - `watch.ts` → `agent.getProjectsDir()`
- Removed dead `getClaudeProjectsDir()` from `watch/paths.ts`
- Updated `init.ts`, `existingConfigCapture.ts` for `hasConfigFile` rename
- Updated all test mocks and assertions for new import paths and param names

### Commit 3: Introduce explicit Skillset type and parseSkillset function

**Refactor B progress:** Created a centralized `Skillset` type and `parseSkillset()` function. Profile sub-loaders no longer independently construct filesystem paths — they receive a pre-parsed `Skillset` object.

Changes:
- Created `src/cli/features/skillset.ts` with `Skillset` type and `parseSkillset()` function
  - `Skillset` maps the filesystem structure: `name`, `dir`, `metadata`, `skillsDir`, `claudeMdPath`, `slashcommandsDir`, `subagentsDir` (nullable for optional components)
  - `parseSkillset()` resolves skillset directory, ensures nori.json exists (backwards compat), reads metadata, checks for optional component directories
- Created `src/cli/features/skillset.test.ts` with 8 tests covering fully-populated, minimal, namespaced, missing, and legacy skillsets
- Updated `ProfileLoader` interface in `skillsetLoaderRegistry.ts` to accept `{ config: Config; skillset: Skillset }`
- Updated `profilesLoader` in `loader.ts` to call `parseSkillset()` once and pass result to all sub-loaders
- Updated all 4 profile sub-loaders to consume `Skillset` instead of constructing paths independently:
  - `skills/loader.ts` — removed `getProfileDir`, `getConfigDir`; uses `skillset.skillsDir`
  - `claudemd/loader.ts` — removed `getProfileClaudeMd`; uses `skillset.claudeMdPath`; `generateSkillsList` now takes `{ skillsDir }` instead of `{ skillsetName }`
  - `slashcommands/loader.ts` — removed `getConfigDir`; uses `skillset.slashcommandsDir`
  - `subagents/loader.ts` — removed `getConfigDir`; uses `skillset.subagentsDir`
- Updated `agent.ts` `captureExistingConfig` to parse skillset before calling `claudeMdLoader.install`
- Updated all 4 sub-loader test files with `installWithSkillset` helper pattern

## Remaining Work

### Refactor A (continued): Further agent decoupling
- `AgentName` type is still a literal `"claude-code"` string union

### Refactor B (continued): Further Skillset type usage
- Other callers outside the profile loader chain may still construct skillset paths independently
- The `Skillset` type could be extended to include more parsed metadata as needed

### Refactor C: Multi-agent support improvements
- Need clear semantic functions for adding/removing skillsets per agent per directory
- Need tracking of local changes per agent per directory
- Need handling of config changes triggering skillset rebroadcast
- Need handling of install directory changes (switch + cleanup)
