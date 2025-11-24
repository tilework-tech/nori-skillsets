# Nori Profiles

**Codify your workflow. Stop repeating yourself.**

Coding agents excel at POCs but struggle to deliver in complex products where the details matter. This is a context issue, the agent does not have enough information in active context about your project, your git preferences, testing regime, product documentation, development standards, and so on. And it is impractical to expect an engineer to provide all that information at the start of every session, creating an information gap that we should not expect and agent to be able to cross.

Nori Profiles lets you codify the repeating aspects of your workflow so you can spend your cognitive load on productive development.

**The core insight:** 

![Console](https://raw.githubusercontent.com/tilework-tech/nori-plugin/refs/heads/main/Console.png)

## Installation

```bash
npx nori-ai@latest install
```

Launch Claude Code from your terminal. Nori features activate automatically.

### Select Your Profile

During installation, choose the profile that matches your role:

- **senior-swe**: High-confirmation co-pilot mode
- **product-manager**: Autonomous execution with technical guidance
- **documenter**: Documentation-focused workflows

Switch profiles anytime:

```bash
npx nori-ai@latest switch-profile <profile-name>
```

Or use `/nori-switch-profile` during a conversation.

## Requirements

- Node.js 22 or higher
- Claude Code CLI installed

## The Problem: Repetition Kills Productivity

Every coding session with a general-purpose agent looks the same:

- **Re-establishing context**: "Remember to use TDD. Don't skip tests. Update the docs. Follow our architecture patterns."
- **Task-specific tuning**: Debugging needs different behavior than planning. Backend work needs different context than frontend. You manually adjust every time.
- **Role mismatches**: Senior engineers want efficiency and minimal hand-holding. Product managers need technical guidance. Everyone uses the same generic agent.
- **Workflow inconsistency**: Without codified processes, agents skip verification, take shortcuts, and claim success without proof.

The result: **You waste cognitive energy instructing instead of developing.** Your agent should already know how you work.

## How Nori Profiles Solves This

Nori Profiles gives you three core capabilities that eliminate repetition:

### 1. Creating Profiles: Codifying your workflow

Define precise scopes of behavior for your development tasks. Your preferences for git automation, PRs creation, testing, and planning, optimized for context using all the best configuration options - agent.md, skills, subagents, and tools.

**Built-in profiles:**
- `senior-swe`: High-confirmation co-pilot with extensive planning, assumes engineering expertise
- `product-manager`: Full autonomy with frequent commits, provides technical guidance without hand-holding
- `documenter`: Specialized workflows focused on documentation quality
- `amol`: Personal profile fine-tuned for running multiple agents in parallel

**Roll your own:** Copy an existing profile structure, write a CLAUDE.md, pull in the mixins you want. Launch different modes of work that instantly tune the agent for the task at hand.

### 2. Documentation: Living Memory Across Sessions

Automatically create and maintain `docs.md` files throughout your codebase. Nori configures agents to read and write documentation—every change must come with a docs.md update, and every folder must have one.

**With Nori server (paid):** Agents query a shared documentation database capturing conversations from your entire team and integrations (git/Jira/Linear/Drive). Your team's institutional memory becomes your agent's memory. No more repeated explanations.

### 3. Process Enforcement: Prevent Shortcuts Automatically

Agents are naturally expeditious — they skip verification, take debugging shortcuts, claim success without proof. Nori enables to you enforce important development standards so that you can trust their work product.


## Features

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
- **Living documentation system**: Automatically updates as your codebase evolves—docs.md files stay synchronized with code changes
- **Automatic conversation capture**: Git-style hooks capture full conversation summaries with zero manual effort, preserving decisions and reasoning

## Commands

```bash
npx nori-ai              # Install (default)
npx nori-ai install      # Install (explicit)
npx nori-ai uninstall    # Uninstall all features
npx nori-ai help         # Show help message
npx nori-ai check        # Run configuration validation
```

## Special Thanks

- [Simon Willison](https://simonwillison.net/) for inspiration
- [Jesse Vincent](https://blog.fsck.com/) for valuable insight and the superpowers library, which forms the basis of Nori's skills
- The [humanlayer](https://github.com/humanlayer/humanlayer/tree/main) team for great writing on using agents and some subagent implementations
