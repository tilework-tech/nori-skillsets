# Research Notes: New Agent Support

## Existing Architecture

Each agent is defined as an `AgentConfig` object in `src/cli/features/<agent-name>/agent.ts` with:
- `name`: AgentName union member
- `displayName`, `description`
- Path functions: `getAgentDir`, `getSkillsDir`, `getSubagentsDir`, `getSlashcommandsDir`, `getInstructionsFilePath`
- `getLoaders()`: array of shared + agent-specific loaders
- Optional: `getTranscriptDirectory`, `getArtifactPatterns`

The `AgentRegistry` singleton registers all agents. The `AgentName` type is a union of all agent name strings.

Shared loaders (used by all agents): configLoader, skillsLoader, createInstructionsLoader, createSlashCommandsLoader, createSubagentsLoader.
Claude-specific loaders: hooksLoader, statuslineLoader, announcementsLoader.

## New Agent Research Results

### codex (OpenAI Codex CLI)
- **Config dir**: `.codex/` (project), `~/.codex/` (user)
- **Instructions**: `AGENTS.md` at project root (walks git root to cwd)
- **Skills**: No native skills system
- **Subagents**: Experimental multi-agent
- **Slash commands**: `~/.codex/prompts/` (custom prompts)
- **Transcripts**: `~/.codex/sessions/YYYY/MM/DD/`

### droid (Factory Droid)
- **Config dir**: `.factory/` (project), `~/.factory/` (user)
- **Instructions**: `AGENTS.md` at project root and `~/.factory/AGENTS.md`
- **Skills**: No native skills (Custom Droids serve a similar role)
- **Subagents**: `.factory/droids/*.md` (Custom Droids)
- **Slash commands**: `.factory/commands/` (md/mdx/executables)
- **Transcripts**: `~/.factory/` sessions

### gemini-cli (Google Gemini CLI)
- **Config dir**: `.gemini/` (project), `~/.gemini/` (user)
- **Instructions**: `GEMINI.md` at project root (hierarchical loading, configurable via `context.fileName`)
- **Skills**: No native skills
- **Subagents**: `.gemini/agents/*.md` (experimental, YAML frontmatter)
- **Slash commands**: `.gemini/commands/*.toml`
- **Transcripts**: `~/.gemini/tmp/<project_hash>/chats/`

### github-copilot
- **Config dir**: `.github/` (project), `~/.copilot/` (user)
- **Instructions**: `.github/copilot-instructions.md` + `.github/instructions/*.instructions.md`
- **Skills**: No native skills system
- **Subagents**: `.github/agents/*.agent.md`
- **Slash commands**: `.github/prompts/*.prompt.md` (VS Code only)
- **Transcripts**: Web UI only, no local files

### goose (Block/Square)
- **Config dir**: No project-level dir, `~/.config/goose/` (user)
- **Instructions**: `.goosehints` at project root, also reads `AGENTS.md`
- **Skills**: No native skills
- **Subagents**: Built-in auto-spawning (not file-configured)
- **Slash commands**: Via `config.yaml` recipes
- **Transcripts**: `~/.local/share/goose/sessions/sessions.db`

### kilo (Kilo Code)
- **Config dir**: `.kilocode/` (project), `~/.kilocode/` (user)
- **Instructions**: `.kilocode/rules/*.md` + `AGENTS.md` at root
- **Skills**: `.kilocode/skills/` with `SKILL.md` files (very similar to Nori)
- **Subagents**: Modes system (not file-based subagents)
- **Slash commands**: Built-in mode switching
- **Transcripts**: VS Code globalStorage

### kimi-cli (Kimi Code)
- **Config dir**: `.kimi/` or `.agents/` (project), `~/.kimi/` (user)
- **Instructions**: `AGENTS.md` at project root (priority: AGENTS.md > .cursorrules > KIMI.md)
- **Skills**: `.agents/skills/` or `.kimi/skills/` with `SKILL.md`
- **Subagents**: YAML-defined agents with Task tool
- **Slash commands**: Built-in (20+)
- **Transcripts**: `~/.kimi/sessions/`

### opencode
- **Config dir**: `.opencode/` (project), `~/.config/opencode/` (user)
- **Instructions**: `AGENTS.md` at project root (falls back to CLAUDE.md)
- **Skills**: `.opencode/skills/` with `SKILL.md` (also reads `.claude/skills/`)
- **Subagents**: `.opencode/agents/*.md`
- **Slash commands**: `.opencode/commands/*.md`
- **Transcripts**: `~/.local/share/opencode/` (SQLite)

### openclaw
- **Config dir**: `~/.openclaw/workspace/` (global), no project-level dir
- **Instructions**: `AGENTS.md` in workspace + `SOUL.md`, `USER.md`
- **Skills**: `skills/` in workspace with `SKILL.md`
- **Subagents**: Built-in `/subagents` command
- **Slash commands**: Skills auto-register as commands
- **Transcripts**: `~/.openclaw/agents/<id>/sessions/`

### pi (Pi Coding Agent)
- **Config dir**: `.pi/` (project), `~/.pi/agent/` (user)
- **Instructions**: `.pi/AGENTS.md` or `AGENTS.md` at root (walks up parents)
- **Skills**: `~/.pi/agent/skills/` with markdown-based skills
- **Subagents**: Not built-in (deliberate design choice)
- **Slash commands**: Built-in + `~/.pi/agent/prompts/`
- **Transcripts**: `~/.pi/agent/sessions/` (JSONL)

## Implementation Mapping

Each agent maps to an `AgentConfig` with these paths:

| Agent | agentDir | instructionsFile | skillsDir | subagentsDir | slashcommandsDir |
|-------|----------|-----------------|-----------|--------------|-----------------|
| codex | .codex/ | .codex/AGENTS.md | .codex/skills/ | .codex/agents/ | .codex/commands/ |
| droid | .factory/ | .factory/AGENTS.md | .factory/skills/ | .factory/droids/ | .factory/commands/ |
| gemini-cli | .gemini/ | .gemini/GEMINI.md | .gemini/skills/ | .gemini/agents/ | .gemini/commands/ |
| github-copilot | .github/ | .github/copilot-instructions.md | .github/skills/ | .github/agents/ | .github/prompts/ |
| goose | .goose/ | .goose/AGENTS.md | .goose/skills/ | .goose/agents/ | .goose/commands/ |
| kilo | .kilocode/ | .kilocode/rules/AGENTS.md | .kilocode/skills/ | .kilocode/agents/ | .kilocode/commands/ |
| kimi-cli | .kimi/ | .kimi/AGENTS.md | .kimi/skills/ | .kimi/agents/ | .kimi/commands/ |
| opencode | .opencode/ | .opencode/AGENTS.md | .opencode/skills/ | .opencode/agents/ | .opencode/commands/ |
| openclaw | .openclaw/ | .openclaw/AGENTS.md | .openclaw/skills/ | .openclaw/agents/ | .openclaw/commands/ |
| pi | .pi/ | .pi/AGENTS.md | .pi/skills/ | .pi/agents/ | .pi/commands/ |

All new agents use the same 5 shared loaders as cursor (configLoader, skillsLoader, instructionsLoader, slashCommandsLoader, subagentsLoader). No new agent needs agent-specific loaders.

Instructions loader config:
- Agents with instructions file directly in agentDir: use `managedFiles: ["AGENTS.md"]` (or "GEMINI.md", "copilot-instructions.md")
- Agents with instructions in a subdirectory (kilo): use `managedDirs: ["rules"]`
