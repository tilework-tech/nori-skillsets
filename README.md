# Nori

**Packaged customization for coding agents. Put Claude Code in hyperdrive.**

Coding agents are magical, but they are general-purpose tools that need to be customized for your team. Otherwise, as you scale they will produce risky slop. Customizing agents is time-intensive and the landscape changes daily. Nori provides packaged customization that provides your engineering team the path to velocity and quality at scale.

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

## The Problem

Generic coding agents work great initially but degrade with scale:

- **Documentation debt compounds**: AI needs context. Without great docs, teams lose track of decisions, architecture, and the intention behind changes. When coding agents are doing most of the coding, docs cannot be an afterthought.
- **Shortcuts accumulate**: Without enforced processes, agents skip TDD, take debugging shortcuts, and claim success without verification.
- **Patterns diverge**: Different engineers get different patterns from the agent. No shared context means inconsistent outputs.
- **Configuration burden**: Every team rebuilds the same customizations. Prompts, workflows, and guardrails require constant maintenance.

The result: **slop that accumulates faster than your ability to manage it.**

## How Nori Fixes This

Nori provides three core capabilities that transform coding agents from generic assistants into team-aligned tools:

### 1. Documentation: Living Docs That Evolve With Your Code

Automatically create and maintain `docs.md` files throughout your codebase.
Nori configures AI agents to read and write documentation. Every change must
come with a docs.md file update, and there must be a docs.md file in every
folder in your codebase.

If you are using the Nori server (paid), Nori will additionally capture
conversations from your entire team, and can be configured to ingest from
across your team's knowledge sources (git/jira/linear/drive/etc). Nori-powered
agents are required to query that database before making any changes.

Your team's institutional memory becomes your coding agent's memory. No more repeated explanations.

### 2. Tests: Process Enforcement That Prevents Shortcuts

Coding agents act like junior engineers. They skip verification steps, take debugging shortcuts, and claim success without real proof.

Nori enforces Test Driven Development. All agents have to run red-green-refactor
cycles for any changes. Before writing any code, agents have to write tests.
This guarantees that your behavioral intent is captured while the coding agent
is most 'lucid' (i.e. at the beginning of the context window).

Nori comes with additional strategies for systematic debugging and root cause
tracing to make debugging a breeze.

Code quality stays high at scale. No shortcuts, no unverified claims, no technical debt from "tests later."

### 3. Profiles: Role-Based Customization Out of the Box

Coding agents are being used by more and more contributors, not just senior engineers. This creates obvious risk as different team members have varying skills and knowledge of best practices. Senior engineers want efficiency, product managers need guidance.

Nori comes with pre-built profiles, and a dead-simple profile switcher. Run with
one of the existing profile sets:

- `senior-swe`: High-confirmation co-pilot mode, extensive planning leaning on the knowledge of the engineer
- `product-manager`: Full autonomy with frequent commits, technical guidance without hand-holding
- `documenter`: Specialized behavior focused on documentation
- `amol`: My personal profile. Fine tuned to run a half dozen agents in parallel.

Or roll your own. Just copy one of the existing profile structures, write a CLAUDE.md, and pull in whatever mixins you want.

Teams on Nori get role-appropriate behavior immediately. No configuration burden, no rebuilding common patterns.

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
- **Recipe extraction**: Recipe-writer subagent identifies and documents reusable patterns from successful implementations
- **Multi-strategy search**: Combines keyword, fuzzy, and vector search to surface relevant documentation automatically during conversations
- **Memorize/Recall/UpdateMemory tools**: Claude can save and query team documentation during conversations, eliminating repeated explanations
- **Usage analytics**: Track token usage, costs, and AI impact with daily LLM-generated reports

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
