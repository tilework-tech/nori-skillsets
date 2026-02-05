# Nori Skillsets Client

[![CI](https://github.com/tilework-tech/nori-skillsets/actions/workflows/ci.yml/badge.svg)](https://github.com/tilework-tech/nori-skillsets/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/nori-skillsets)](https://www.npmjs.com/package/nori-skillsets)
[![npm license](https://img.shields.io/npm/l/nori-skillsets)](https://www.npmjs.com/package/nori-skillsets)
[![npm downloads](https://img.shields.io/npm/dm/nori-skillsets)](https://www.npmjs.com/package/nori-skillsets)

**CLI Client for installing and managing Nori Skillsets**

The Nori Skillsets Client connects you to [noriskillsets.dev](https://noriskillsets.dev/), a registry of verified Claude Code Skills and packaged agent configurations. Install complete Skillsets or individual Skills that have been reviewed for effectiveness, clarity, and proper implementation.

For complete documentation and to browse available Skillsets, visit:
- **Skillsets Registry**: [noriskillsets.dev](https://noriskillsets.dev/)
- **Documentation**: [usenori.ai/docs/skillsets.html](https://usenori.ai/docs/skillsets.html)

## What is a Skillset?

A Skillset is a complete, unified configuration that defines how your coding agent behaves. Skillsets can include:

- **Skills**: Step-by-step instructions that encode specific agent behaviors (TDD, debugging, code review, git workflows)
- **CLAUDE.md**: Custom instructions and workflow preferences that guide the agent
- **Subagents**: Specialized agents for specific tasks (codebase search, documentation, research)
- **Slash Commands**: Quick actions that invoke Skills and workflows

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
nori-skillsets switch-skillset senior-swe
```

## How Skillsets Work

Skillsets are stored in `~/.nori/profiles/` as your library of available configurations. When you switch to a Skillset, the client copies its contents into the relevant locations in `cwd/.claude/` where Claude Code reads them.

**Skillset Structure:**
```
~/.nori/profiles/my-skillset/
├── CLAUDE.md              # Custom instructions
├── skills/                # Skill definitions
│   ├── my-skill/
│   │   └── SKILL.md
│   └── another-skill/
│       └── SKILL.md
├── subagents/             # Subagent configurations
└── slashcommands/         # Custom slash commands
```

When you activate a Skillset:
1. The client cleans any existing configuration in `cwd/.claude/`
2. Copies the selected Skillset from `cwd/.nori/profiles/<skillset-name>/` to `cwd/.claude/`
3. Claude Code reads the new configuration in your next session

This separation lets you maintain multiple Skillsets and switch between them without losing any configuration.

## Requirements

- Node.js 22 or higher
- Claude Code CLI installed
- Mac or Linux operating system

## Creating custom skillsets or making changes to skillsets

1. Create the skillset directory:
   ```bash
   mkdir -p ~/.nori/profiles/my-skillset
   ```

2. Add a `CLAUDE.md` file with your custom instructions:
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
   nori-skillsets switch-skillset my-skillset
   ```

Manual changes made to a `.claude/` directory will be removed when switching skillsets. Manual changes should be made in the .nori/profile/ directory instead.

## Private Skillsets for Teams

Teams can set up private registries to share custom Skillsets across the organization. With private registries:

- Full access control - only your organization can view and install
- Package working configurations and publish internally
- Teammates install the exact setup that proved successful
- Optional Skills Review service: professional evaluation before publication

Contact us at [usenori.ai](https://usenori.ai/#contact) to set up a private registry for your team.

## Resources

- **Skillsets Registry**: [noriskillsets.dev](https://noriskillsets.dev/)
- **Documentation**: [usenori.ai/docs/skillsets.html](https://usenori.ai/docs/skillsets.html)
- **GitHub**: [github.com/tilework-tech/nori-skillsets](https://github.com/tilework-tech/nori-skillsets)
- **npm**: [npmjs.com/package/nori-skillsets](https://www.npmjs.com/package/nori-skillsets)
- **Contact**: [usenori.ai](https://usenori.ai/#contact)
