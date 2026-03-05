# Current Progress: New Agents Support

## Completed

### Agent Research
- Researched all 10 new agents: codex, droid, gemini-cli, github-copilot, goose, kilo, kimi-cli, opencode, openclaw, pi
- Documented config directory conventions, instruction file paths, skills/subagents/commands support, and transcript locations for each
- Results captured in RESEARCH-NOTES.md

### Implementation
- Created `agent.ts` and `paths.ts` for all 10 new agents under `src/cli/features/`
- Each agent follows the cursor-agent pattern with 5 shared loaders
- Extended `AgentName` type union from 2 to 12 members
- Registered all 10 new agents in `AgentRegistry` constructor
- All agents use their native directory conventions:
  - codex: `.codex/`
  - droid: `.factory/` (with `droids/` for subagents)
  - gemini-cli: `.gemini/` (with `GEMINI.md` instructions)
  - github-copilot: `.github/` (with `copilot-instructions.md` and `prompts/`)
  - goose: `.goose/`
  - kilo: `.kilocode/` (with `rules/AGENTS.md`)
  - kimi-cli: `.kimi/`
  - opencode: `.opencode/`
  - openclaw: `.openclaw/`
  - pi: `.pi/`

### Testing
- 140 new tests across 20 test files (agent.test.ts + paths.test.ts per agent)
- Updated agentRegistry.test.ts to expect 12 agents
- Full test suite passes: 1672 tests, 124 test files

### Documentation
- Updated `src/cli/features/docs.md` with new agent information
- Updated RESEARCH-NOTES.md with findings
