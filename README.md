# Nori Skillsets

(Previously Nori Profiles)

**Create custom skillsets that are fit for purpose.**

As projects grow in complexity and specificity, off the shelf agents become less effective. Nori Skillsets is a tool for building and switching between sets of skills that are encoded with your development patterns, design standards, and engineering workflows.

Nori lets you precisely define how you want your coding agent to reliably behave for a wide range of tasks:
- Define consistent behavior for areas of development, tasks, or team roles
- Automate repeated steps of your workflow to offload your cognitive load, such as git workflows, file references, and testing
- Switch between skillsets instantly without repeating setup or context

Under the hood, Nori wraps Claude Code with a config management system that automatically defines desired behavior in agent configuration and context layers like CLAUDE.md, SKILLs, Subagents, and more. It also hooks into the Claude Code CLI, providing small QoL improvements to improve the overall experience of agentic coding.

![Console](https://raw.githubusercontent.com/tilework-tech/nori-plugin/refs/heads/main/Console.png)

## Installation

```bash
npm install -g nori-ai
nori-ai install
```

Launch Claude Code from your terminal. Nori features activate automatically.

### Quick Start with npx

For registry operations without a full install, use the `nori-skillsets` package:

```bash
# Search for profiles and skills
npx nori-skillsets search <term>

# Download a profile
npx nori-skillsets download <profile-name>

# Install a profile (download + activate)
npx nori-skillsets install <profile-name>
```

## Requirements

- Node.js 22 or higher
- Claude Code CLI installed
- Mac or Linux operating system

### Start by testing a skillset

During installation, choose a sample skillset to try out how Nori works.

Examples:

- **senior-swe**: High-confirmation co-pilot mode
- **product-manager**: Autonomous execution with technical guidance
- **documenter**: Documentation-focused workflows

Switch skillsets anytime:

```bash
nori-ai switch-skillset <skillset-name>
```

Or use `/nori-switch-skillset` during a conversation.


### How to create your own skillset

Define precise scopes of behavior for your development tasks. Your preferences for git automation, PRs creation, testing, and planning, optimized for context using all the best configuration options - agent.md, skills, subagents, and tools.

**Ask Claude Code to build it with you:**

Run

```
/nori-create-skillset
```

Claude will guide you through:
- Understanding your role and development style
- Identifying repeating instructions you give
- Choosing relevant mixins (engineering, product, documentation workflows)
- Writing your custom CLAUDE.md with your preferences
- Setting up the skillset structure

**Building a skillset explicitly**

1. Create the skillset directory:
   ```bash
   mkdir -p ~/.claude/profiles/my-skillset
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
   nori-ai switch-skillset my-skillset
   ```

   Or use `/nori-switch-skillset` during a conversation.

**Skillset structure:**

Skillsets live in `~/.claude/profiles/` and contain:
- `CLAUDE.md`: Your custom instructions and workflow preferences
- Mixins: Linked configuration options
- Custom skills and slash commands (optional)

Each skillset represents a distinct mode of work, letting you instantly tune the agent for different tasks.

## Additional Features

### Nori-skillsets

_Enhances Claude Code with improved visibility and automations._

- **6-checkpoint development workflow**: Setup verification → research → plan approval → TDD cycle → implementation → verification
- **32+ engineering skills**: Step-by-step instructions for TDD, debugging, code review, git workflows, architecture decisions
- **3 built-in skillsets**: senior-swe, product-manager, documenter
- **Real-time status line**: Git branch, active skillset, token usage, conversation cost
- **Slash commands**: Quick access to workflows (`/nori-info`, `/nori-debug`, `/nori-init-docs`, `/nori-switch-profile`)
- **Specialized subagents**: codebase-locator, codebase-analyzer, codebase-pattern-finder, web-search-researcher
- **Local noridocs**: Automatic documentation with change-documenter and initial-documenter subagents

### nori-registry (Paid)

_Package manager for uploading, discovering, and downloading custom coding agents across a team._

Upload your custom agents to a shared registry where your team can discover and download them. Search by name, tags, or description. Download agents instantly with a single command. Makes it easy to share specialized agents across your organization.

### nori-watchtower (Paid)

_Transcript search server for providing institutional and organizational memory to agents across a team._

Automatically store session transcripts from every engineer on your team. Make them searchable and accessible to your team, and your agents. Agents can use watchtower to source extra documentation and context that may not be present in the codebase. You can use watchtower to get insight into how your team is functioning.

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
