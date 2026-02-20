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

## Remaining Work

### Refactor A (continued): Further agent decoupling
- `AgentName` type is still a literal `"claude-code"` string union

### Refactor B: Explicit Skillset types
- No explicit `Skillset` type exists yet that describes the package structure at `~/.nori/profiles/`
- Need a parsing layer that lives above the agent registry
- Need to modify agent registry functions to ingest the new skillset type
- Need to modify underlying functions so that instead of hardcoding skillset semantics, the agent registry functions read off the skillset type directly

### Refactor C: Multi-agent support improvements
- Need clear semantic functions for adding/removing skillsets per agent per directory
- Need tracking of local changes per agent per directory
- Need handling of config changes triggering skillset rebroadcast
- Need handling of install directory changes (switch + cleanup)
