# Nori Skillsets Client

[![CI](https://github.com/tilework-tech/nori-skillsets/actions/workflows/ci.yml/badge.svg)](https://github.com/tilework-tech/nori-skillsets/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/nori-skillsets)](https://www.npmjs.com/package/nori-skillsets)
[![npm license](https://img.shields.io/npm/l/nori-skillsets)](https://www.npmjs.com/package/nori-skillsets)
[![npm downloads](https://img.shields.io/npm/dm/nori-skillsets)](https://www.npmjs.com/package/nori-skillsets)

**CLI Client for installing and managing Nori Skillsets**

The Nori Skillsets Client connects you to [noriskillsets.dev](https://noriskillsets.dev/), a registry of verified agent Skills and packaged agent configurations. Install complete Skillsets or individual Skills that have been reviewed for effectiveness, clarity, and proper implementation.

The client supports a wide range of coding agents (Claude Code, Cursor, Codex, Gemini CLI, GitHub Copilot, OpenCode, Goose, Kilo, Kimi CLI, Pi, OpenClaw, Droid). Each agent receives a translation of the same skillset into the format it expects on disk.

For complete documentation and to browse available Skillsets, visit:
- **Skillsets Registry**: [noriskillsets.dev](https://noriskillsets.dev/)
- **Documentation**: [noriskillsets.dev/docs](https://noriskillsets.dev/docs/building-a-skillset)

## What is a Skillset?

A Skillset is a complete, unified configuration that defines how your coding agent behaves. Skillsets can include:

- **Skills**: Step-by-step instructions that encode specific agent behaviors (TDD, debugging, code review, git workflows)
- **AGENTS.md / CLAUDE.md**: Custom instructions and workflow preferences that guide the agent
- **Subagents**: Specialized agents for specific tasks (codebase search, documentation, research)
- **Slash Commands**: Quick actions that invoke Skills and workflows
- **MCP servers**: Bundled Model Context Protocol server configs translated into each agent's expected format at install time (e.g., `.mcp.json` for Claude, `config.toml` for Codex, `settings.json` for Gemini, `mcp.json` for Cursor)

## Installation

Install the client:

```bash
npm install -g nori-skillsets
```

Run init to set up a skillsets folder at cwd/.nori/profiles and capture your existing configs.
Note that this will set up in the folder that you run the command in, allowing you to scope skillsets by project.

```bash
nori-skillsets init
```

Download a skillset from noriskillsets.dev.

```bash
nori-skillsets download senior-swe
```

Switch to using the new skillset.

```bash
nori-skillsets switch senior-swe
```

## How Skillsets Work

Skillsets are stored in `~/.nori/profiles/` as your library of available configurations. When you switch to a Skillset, the client writes its contents into the relevant locations for each configured agent (e.g., `.claude/` for Claude Code, `.cursor/` for Cursor, `.codex/` for Codex, `.gemini/` for Gemini CLI). Configure which agents to target with `nori-skillsets config`.

**Skillset Structure:**
```
~/.nori/profiles/my-skillset/
├── AGENTS.md              # Custom instructions (CLAUDE.md also supported)
├── nori.json              # Skillset manifest (name, version, dependencies, requiredEnv)
├── skills/                # Skill definitions
│   ├── my-skill/
│   │   └── SKILL.md
│   └── another-skill/
│       └── SKILL.md
├── subagents/             # Subagent configurations
├── slashcommands/         # Custom slash commands
└── mcp/                   # Canonical MCP server configs (one JSON file per server)
```

When you activate a Skillset:
1. The client cleans any existing configuration in each configured agent's directory
2. Translates the skillset into the format each agent expects and writes it to the corresponding agent directory
3. Each agent reads the new configuration in its next session

This separation lets you maintain multiple Skillsets, target multiple agents at once, and switch between them without losing any configuration.

## Requirements

- Node.js 22 or higher
- At least one supported coding agent CLI installed (Claude Code, Cursor, Codex, Gemini CLI, etc.)
- Mac or Linux operating system

## Creating custom skillsets or making changes to skillsets

1. Create the skillset directory:
   ```bash
   mkdir -p ~/.nori/profiles/my-skillset
   ```

2. Add an `AGENTS.md` file with your custom instructions:
   ```markdown
   # My Custom Skillset

   Add your workflow preferences here:
   - Testing requirements
   - Git automation rules
   - Code style guidelines
   - Any repeating instructions
   ```

3. Activate your skillset:
   ```bash
   nori-skillsets switch my-skillset
   ```

Manual changes made to an agent's installed directory (e.g., `.claude/`, `.cursor/`, `.codex/`) will be removed when switching skillsets. Manual changes should be made in the `~/.nori/profiles/<skillset-name>/` directory instead.

## Private Skillsets for Teams

Teams can set up private registries to share custom Skillsets across the organization. With private registries:

- Full access control - only your organization can view and install
- Package working configurations and publish internally
- Teammates install the exact setup that proved successful
- Optional Skills Review service: professional evaluation before publication

Contact us at [noriagentic.com](https://noriagentic.com) to set up a private registry for your team.

## Resources

- **Skillsets Registry**: [noriskillsets.dev](https://noriskillsets.dev/)
- **Documentation**: [noriskillsets.dev/docs](https://noriskillsets.dev/docs/building-a-skillset)
- **GitHub**: [github.com/tilework-tech/nori-skillsets](https://github.com/tilework-tech/nori-skillsets)
- **npm**: [npmjs.com/package/nori-skillsets](https://www.npmjs.com/package/nori-skillsets)
- **Contact**: [noriagentic.com](https://noriagentic.com)
