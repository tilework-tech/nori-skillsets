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
- Fixed `getCursorAgentsMdFile()` to return `{installDir}/AGENTS.md` (project root) instead of `{installDir}/.cursor/AGENTS.md`
- Cursor reads AGENTS.md from the project root, not from inside `.cursor/`
- `getManagedFiles()` now returns `[]` since AGENTS.md is outside the `.cursor/` agent directory
- Root-level AGENTS.md is explicitly tracked in the manifest during `installSkillset`
- Root-level AGENTS.md is explicitly checked during `detectLocalChanges`
- Root-level AGENTS.md is explicitly deleted during `removeSkillset`

### Agent description property and config UI hints
- Added `description: string` to the `Agent` type interface
- Claude Code: `"Instructions, skills, subagents, commands, hooks, statusline"`
- Cursor: `"Instructions, skills, subagents, commands"`
- Config multiselect now passes `hint: agent.description` so users see supported features
- Updated `ConfigFlowCallbacks.onResolveAgents` return type to include `description`

### Tests updated (55 tests, all passing)
- Updated `paths.test.ts` to verify AGENTS.md at project root
- Updated `agent.test.ts` to verify AGENTS.md placement, removal, and change detection at root
- Added agent description test in `agentRegistry.test.ts`

### Fix: switchSkillset preserves all config fields
- Both `claudeCodeAgent.switchSkillset` and `cursorAgent.switchSkillset` now pass `defaultAgents` and `garbageCollectTranscripts` through to `saveConfig`
- Previously these fields were silently dropped on every skillset switch, causing data loss in multi-agent setups
- Added tests for both agents verifying config field preservation

## Not Yet Implemented

### Features NOT included (by design)
- No hooks loader (Cursor doesn't support Claude Code-style hooks)
- No statusline loader (Cursor-specific, not needed)
- No announcements loader (Claude Code-specific)
- No factoryReset, detectExistingConfig, captureExistingConfig (can be added later if needed)
- No getProjectDirName, getProjectsDir (Cursor doesn't have the same project-scoping model)
