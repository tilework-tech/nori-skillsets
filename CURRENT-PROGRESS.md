# Cursor Agent - Implementation Progress

## Completed

### Core cursor-agent implementation
- Created `src/cli/features/cursor-agent/` directory with full agent implementation
- `agent.ts` - Implements the `Agent` interface for Cursor IDE (`.cursor/` directory)
- `paths.ts` - Path helpers for `.cursor` directory structure
- `loaderRegistry.ts` - `CursorLoaderRegistry` with config + profiles loaders
- Registered `cursor-agent` in `AgentRegistry` alongside `claude-code`
- Updated `AgentName` type to `"claude-code" | "cursor-agent"`

### Skillset loaders
- `skillsets/loader.ts` - Top-level profiles loader (creates ~/.nori/profiles/, runs sub-loaders)
- `skillsets/skillsetLoaderRegistry.ts` - `CursorProfileLoaderRegistry` (skills, agentsmd, slashcommands, subagents)
- `skillsets/agentsmd/loader.ts` - Maps CLAUDE.md to AGENTS.md with managed block markers
- `skillsets/skills/loader.ts` - Copies skills to `.cursor/skills/` with template substitution
- `skillsets/slashcommands/loader.ts` - Copies slash commands to `.cursor/commands/`
- `skillsets/subagents/loader.ts` - Copies subagents to `.cursor/agents/`

### Tests (19 new tests, all passing)
- `agent.test.ts` - isInstalledAtDir, markInstall, switchSkillset, detectLocalChanges, removeSkillset, installSkillset
- `paths.test.ts` - All path helper functions
- Updated `agentRegistry.test.ts` to expect 2 agents

### Documentation
- Updated `src/cli/features/docs.md` to reflect both agents
- Created `src/cli/features/cursor-agent/docs.md`

### AGENTS.md placement fix
- Fixed `getCursorAgentsMdFile()` to return `{installDir}/.cursor/rules/AGENTS.md` (inside cursor rules directory)
- Per APPLICATION-SPEC: AGENTS.md should live inside the cursor rules directory, not the project root
- `getManagedDirs()` includes `"rules"` so the standard manifest machinery handles AGENTS.md automatically
- Removed ~40 lines of bespoke root-level AGENTS.md handling from `detectLocalChanges`, `removeSkillset`, and `installSkillset`
- `agentsmd/loader.ts` creates `.cursor/rules/` directory before writing AGENTS.md

### Agent description property and config UI hints
- Added `description: string` to the `Agent` type interface
- Claude Code: `"Instructions, skills, subagents, commands, hooks, statusline"`
- Cursor: `"Instructions, skills, subagents, commands"`
- Config multiselect now passes `hint: agent.description` so users see supported features
- Updated `ConfigFlowCallbacks.onResolveAgents` return type to include `description`

### Tests updated (55 tests, all passing)
- Updated `paths.test.ts` to verify AGENTS.md at `.cursor/rules/AGENTS.md`
- Updated `agent.test.ts` to verify AGENTS.md placement, removal, and change detection inside `.cursor/rules/`
- Added agent description test in `agentRegistry.test.ts`

### Fix: switchSkillset preserves all config fields
- Both `claudeCodeAgent.switchSkillset` and `cursorAgent.switchSkillset` now pass `defaultAgents` and `garbageCollectTranscripts` through to `saveConfig`
- Previously these fields were silently dropped on every skillset switch, causing data loss in multi-agent setups
- Added tests for both agents verifying config field preservation

### Agent-agnostic init flow and manifest defaults
- Added `configFileName: string` to the `ExistingConfig` type in `agentRegistry.ts`
- `detectExistingConfig` in `existingConfigCapture.ts` now returns `configFileName: "CLAUDE.md"`
- `buildExistingConfigSummary` in `init.ts` uses `config.configFileName` instead of hardcoded `"CLAUDE.md"`
- Ancestor warning text changed from `"Claude Code loads CLAUDE.md files..."` to agent-agnostic `"Some AI coding agents load config files..."`
- `MANAGED_FILES` and `MANAGED_DIRS` defaults in `manifest.ts` changed to empty arrays (all production callers already pass explicit values)
- Legacy `removeManagedFiles` call in `claude-code/agent.ts` now passes explicit `managedDirs`
- Updated manifest tests to pass explicit `CLAUDE_MANAGED_FILES` and `CLAUDE_MANAGED_DIRS` constants
- Added 3 new tests in `init.test.ts` for agent-agnostic display strings
- Updated 4 docs.md files

## Not Yet Implemented

### Features NOT included (by design)
- No hooks loader (Cursor doesn't support Claude Code-style hooks)
- No statusline loader (Cursor-specific, not needed)
- No announcements loader (Claude Code-specific)
- No factoryReset, detectExistingConfig, captureExistingConfig (can be added later if needed)
- No getProjectDirName, getProjectsDir (Cursor doesn't have the same project-scoping model)
