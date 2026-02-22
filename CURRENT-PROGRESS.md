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

## Not Yet Implemented

### Config command multi-agent selection UI
- The config flow already supports multi-select for agents (it reads from AgentRegistry)
- The cursor-agent will appear automatically in the selection
- No code changes needed — the existing config flow handles it

### Features NOT included (by design)
- No hooks loader (Cursor doesn't support Claude Code-style hooks)
- No statusline loader (Cursor-specific, not needed)
- No announcements loader (Claude Code-specific)
- No factoryReset, detectExistingConfig, captureExistingConfig (can be added later if needed)
- No getProjectDirName, getProjectsDir (Cursor doesn't have the same project-scoping model)
