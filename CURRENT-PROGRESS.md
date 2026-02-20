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

## Remaining Work

### Refactor A (continued): Replace hardcoded claude-code paths in commands
- Many CLI commands still import `getClaudeDir` from `claude-code/paths.ts` instead of using `agent.getAgentDir()`
- The `ExistingConfig` type in `agentRegistry.ts` has claude-specific field names (`hasClaudeMd`, `hasManagedBlock`)
- `AgentName` type is still a literal `"claude-code"` string union
- Watch command's `getClaudeProjectsDir()` is hardcoded to `~/.claude/projects/`
- Factory reset module `findClaudeCodeArtifacts` is claude-specific

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
