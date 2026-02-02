---
description: Display information about Nori Skillsets features and capabilities
---

Please read the following information about Nori Skillsets and provide a clear, concise summary to me. After your summary, state: "I loaded the nori documentation. You can ask me for more help about how to use nori if you would like."

Suggest helpful follow-up questions like:

- "How do I switch between skillsets?"
- "What skills are available and when should I use them?"
- "What's the difference between skills and subagents?"

---

# Nori Skillsets Documentation

Nori enhances Claude Code with better context management, specialized workflows, and team collaboration features.

## 1. Skillset System

Skillsets control Claude's behavior and autonomy level. Skillsets can be downloaded from the registry.

### 1.1 Skillset Management

- **Switch skillsets:** `/nori-switch-skillset` or `nori-skillsets switch-skillset`
- **Custom skillsets:** Create your own in `~/.nori/profiles/`
- **Source of truth:** All skillsets stored in `~/.nori/profiles/`

## 2. Skills System

Skills are reusable workflows that guide Claude through complex tasks. Claude automatically references these from `{{skills_dir}}/`.

### 2.1 Available Skills (13)

**Collaboration:**

- **using-skills** - How to use skills (mandatory reading)
- **brainstorming** - Refine ideas through Socratic questioning
- **finishing-a-development-branch** - Final checks before PRs
- **receiving-code-review** - Handle code review feedback with rigor
- **writing-plans** - Create comprehensive implementation plans
- **updating-noridocs** - Update documentation after code changes

**Testing & Debugging:**

- **test-driven-development** - RED-GREEN-REFACTOR TDD cycle
- **testing-anti-patterns** - What NOT to do when writing tests
- **systematic-debugging** - Four-phase debugging framework
- **root-cause-tracing** - Backward tracing technique

**Tools:**

- **using-git-worktrees** - Create isolated workspaces
- **using-screenshots** - Capture screen context
- **webapp-testing** - Playwright-based web testing

## 3. Specialized Subagents

Subagents are autonomous agents that handle complex, multi-step tasks.

### 3.1 Available Subagents (6)

- **nori-web-search-researcher** - Research modern information from the web
- **nori-codebase-analyzer** - Analyze specific components in detail
- **nori-codebase-locator** - Find files and components relevant to a task
- **nori-codebase-pattern-finder** - Find usage examples and patterns to model after
- **nori-initial-documenter** - Generate docs.md files for your codebase
- **nori-change-documenter** - Auto-document code changes

## 4. Hooks System

Hooks execute automatically in response to events like session start/end.

### 4.1 Available Hooks

- **Auto-update check** (SessionStart) - Notify when new Nori versions available
- **Nested install warning** (SessionStart) - Warn about installations in ancestor directories
- **Context usage warning** (SessionStart) - Warn about excessive permissions context usage
- **Worktree cleanup** (SessionStart) - Warn about excessive git worktree disk usage
- **Desktop notifications** (Notification) - Alerts when Claude needs attention
- **Statistics** (SessionEnd) - Calculate and display session usage statistics
- **Slash command intercept** (UserPromptSubmit) - Instant execution of slash commands
- **Commit author** (PreToolUse) - Replace Claude Code attribution with Nori in git commits

## 5. Noridocs Documentation System

An opinionated documentation system with docs.md files in each folder.

- **Format:** Overview, How it fits, Core Implementation, Things to Know
- **Updates:** Manual via updating-noridocs skill
- **Storage:** Part of codebase, tracked in git
- **Initialize:** `/nori-init-docs` to generate throughout codebase

## 6. Status Line

Real-time display of conversation metrics in your Claude Code interface.

### 6.1 Displayed Metrics

- Git branch
- Active skillset name (color-coded in yellow)
- Token usage and conversation costs
- Lines changed

### 6.2 Rotating Tips

- Tips cycling hourly
- Best practices and feature reminders

## 7. CLAUDE.md Behavioral Instructions

Skillset-specific instructions that guide Claude's behavior.

### 7.1 Features

- **Managed block pattern** - Safe updates without destroying user content
- **Dynamic skills list** - Auto-generated from installed skills
- **Skillset-specific workflows** - Tone, autonomy, git behavior
- **Location:** `~/.claude/CLAUDE.md`

## 8. Slash Commands

Custom commands available in Claude Code.

- `/nori-info` - Display this information (you're using it now!)
- `/nori-debug` - Validate Nori installation (`nori-skillsets check`)
- `/nori-install-location` - Display Nori installation directories
- `/nori-switch-skillset` - Switch between skillsets interactively
- `/nori-init-docs` - Generate documentation files throughout codebase

## 9. Installation

```bash
npx nori-skillsets init
```

During installation, you'll be prompted for your profile and optional credentials.

### 9.1 Switch Skillsets

```bash
nori-skillsets switch-skillset
```

Or use the `/nori-switch-skillset` slash command.

## 10. Troubleshooting

If you encounter installation issues, check the installer log file:

```bash
cat /tmp/nori-installer.log
```

This log contains detailed information about the installation process and any errors encountered.

For validation and debugging:

```bash
nori-skillsets check
```

Or use the `/nori-debug` slash command.
