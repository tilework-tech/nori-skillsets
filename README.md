# Nori Profiles

**Codify your workflow. Stop repeating yourself.**

Coding agents excel at POCs but struggle to deliver in complex products where the details matter. This is a context issue. Agents do not have enough information in active context about your project, your git preferences, testing regime, product documentation, development standards, and so on. Engineers can't provide all that information at the start of every session. The result is an information gap about your code that agents struggle to cross.

- **Re-establishing context**: "Remember to use TDD. Don't skip tests. Update the docs. Follow our architecture patterns."
- **Role mismatches**: Senior engineers want efficiency and minimal hand-holding. Product managers need technical guidance. Everyone uses the same generic agent.
- **Workflow inconsistency**: Without codified processes, agents skip verification, take shortcuts, and claim success without proof.

The result: **You waste energy instructing instead of developing.**

Nori Profiles lets you codify the repeating aspects of your workflow so you can focus your attention on productive development.

![Console](https://raw.githubusercontent.com/tilework-tech/nori-plugin/refs/heads/main/Console.png)

## Installation

```bash
npm install -g nori-ai
nori-ai install
```

Launch Claude Code from your terminal. Nori features activate automatically.

## Requirements

- Node.js 22 or higher
- Claude Code CLI installed


### Start by testing a profile

During installation, choose a sample profile to try out how Nori works.

- **senior-swe**: High-confirmation co-pilot mode
- **product-manager**: Autonomous execution with technical guidance
- **documenter**: Documentation-focused workflows

Switch profiles anytime:

```bash
nori-ai switch-profile <profile-name>
```

Or use `/nori-switch-profile` during a conversation.


### How to create your own profile

Define precise scopes of behavior for your development tasks. Your preferences for git automation, PRs creation, testing, and planning, optimized for context using all the best configuration options - agent.md, skills, subagents, and tools.

**Ask Claude Code to build it with you:**

Try a prompt like:

```
"Help me create a custom Nori profile. I want to discuss my workflow preferences."
```

Claude will guide you through:
- Understanding your role and development style
- Identifying repeating instructions you give
- Choosing relevant mixins (engineering, product, documentation workflows)
- Writing your custom CLAUDE.md with your preferences
- Setting up the profile structure

**Building a profile explicitly**

1. Create the profile directory:
   ```bash
   mkdir -p ~/.claude/profiles/my-profile
   ```

2. Add a `CLAUDE.md` file with your custom instructions:
   ```markdown
   # My Custom Profile

   Add your workflow preferences here:
   - Testing requirements
   - Git automation rules
   - Code style guidelines
   - Any repeating instructions
   ```

3. Link to mixins (optional):
   ```bash
   # Link to the SWE mixin for engineering workflows
   ln -s ~/.claude/_mixins/_swe ~/.claude/profiles/my-profile/_swe
   ```

   Available mixins: `_swe` (engineering), `_pm` (product), `_doc` (documentation)

4. Activate your profile:
   ```bash
   nori-ai switch-profile my-profile
   ```

   Or use `/nori-switch-profile` during a conversation.

**Profile structure:**

Profiles live in `~/.claude/profiles/` and contain:
- `CLAUDE.md`: Your custom instructions and workflow preferences
- Mixins: Linked configurations for engineering, PM, or documentation workflows
- Custom skills and slash commands (optional)

Each profile represents a distinct mode of work, letting you instantly tune the agent for different tasks.

## Additional Features

### Free Tier: Local MCP Package

_Enhances Claude Code with process enforcement and systematic workflows—no backend required._

- **6-checkpoint development workflow**: Setup verification → research → plan approval → TDD cycle → implementation → verification
- **32+ engineering skills**: Step-by-step instructions for TDD, debugging, code review, git workflows, architecture decisions
- **3 built-in profiles**: senior-swe, product-manager, documenter
- **Real-time status line**: Git branch, active profile, token usage, conversation cost
- **Slash commands**: Quick access to workflows (`/nori-info`, `/nori-debug`, `/nori-init-docs`, `/nori-switch-profile`)
- **Specialized subagents**: codebase-locator, codebase-analyzer, codebase-pattern-finder, web-search-researcher
- **Local noridocs**: Automatic documentation with change-documenter and initial-documenter subagents

### Paid Tier: + Shared Documentation Server

_Team documentation server that captures, organizes, and surfaces institutional knowledge automatically._

- **Web UI**: Browse, search, and manage documentation artifacts with full markdown editing
- **Living documentation**: Automatically updates as your codebase evolves—docs.md files stay synchronized with code changes
- **Automatic conversation capture**: Git-style hooks capture full conversation summaries with zero manual effort, preserving decisions and reasoning

## Commands

```bash
nori-ai              # Install (default)
nori-ai install      # Install (explicit)
nori-ai uninstall    # Uninstall all features
nori-ai help         # Show help message
nori-ai check        # Run configuration validation
```

## Special Thanks

- [Simon Willison](https://simonwillison.net/) for inspiration
- [Jesse Vincent](https://blog.fsck.com/) for valuable insight and the superpowers library, which forms the basis of Nori's skills
- The [humanlayer](https://github.com/humanlayer/humanlayer/tree/main) team for great writing on using agents and some subagent implementations
