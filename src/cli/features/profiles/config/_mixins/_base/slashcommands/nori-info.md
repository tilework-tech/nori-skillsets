---
description: Display information about Nori Profiles features and capabilities
---

Please read the following information about Nori Profiles and provide a clear, concise summary to me. After your summary, state: "I loaded the nori documentation. You can ask me for more help about how to use nori if you would like."

Suggest helpful follow-up questions like:

- "How do I switch between profiles?"
- "What skills are available and when should I use them?"
- "How do I use the Memorize and Recall skills?"
- "What's the difference between skills and subagents?"
- "How do I upgrade from free to paid?"

---

# Nori Profiles Documentation

Nori enhances Claude Code with better context management, specialized workflows, and team collaboration features.

## 1. Profile System

Profiles control Claude's behavior and autonomy level. Three built-in profiles are available:

### 1.1 senior-swe (Default)

- **Behavior:** Co-pilot mode with high confirmation
- **Worktrees:** Asks user to create branch/worktree
- **Commits/PRs:** Always asks before committing or creating PRs
- **Best for:** Engineers who want control over git operations

### 1.2 amol

- **Behavior:** Full autonomy with frequent commits
- **Worktrees:** Automatically creates worktrees
- **Commits/PRs:** Autonomous commits and PR creation
- **Best for:** Experienced users who want maximum productivity
- **Requires:** Paid tier

### 1.3 product-manager

- **Behavior:** Full autonomy optimized for product managers
- **Best for:** Product managers and users focused on product requirements
- **Requires:** Paid tier

### 1.4 Profile Management

- **Switch profiles:** `/nori-switch-profile` or `nori-ai switch-profile`
- **Custom profiles:** Create your own in `~/.claude/profiles/`
- **Source of truth:** All profiles stored in `~/.claude/profiles/`

**Available in:** Free and Paid

## 2. Skills System

Skills are reusable workflows that guide Claude through complex tasks. Claude automatically references these from `{{skills_dir}}/`.

### 2.1 Free Tier Skills (13)

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

### 2.2 Paid Tier Additional Skills (5)

**Knowledge Base:**

- **recall** - Search the knowledge base for relevant context
- **memorize** - Save important information for future sessions

**Noridocs (Server-side):**

- **read-noridoc** - Read server-side documentation by file path
- **write-noridoc** - Update server-side documentation
- **list-noridocs** - List available noridocs

## 3. Specialized Subagents

Subagents are autonomous agents that handle complex, multi-step tasks.

### 3.1 Free Tier Subagents (6)

- **nori-web-search-researcher** - Research modern information from the web
- **nori-codebase-analyzer** - Analyze specific components in detail
- **nori-codebase-locator** - Find files and components relevant to a task
- **nori-codebase-pattern-finder** - Find usage examples and patterns to model after
- **nori-initial-documenter** - Generate docs.md files for your codebase
- **nori-change-documenter** - Auto-document code changes

### 3.2 Paid Tier Additional Subagents (1)

- **nori-knowledge-researcher** - Deep research using the persistent knowledge base (15 tool call budget)

## 4. Hooks System

Hooks execute automatically in response to events like session start/end.

### 4.1 Free Tier Hooks

- **Auto-update check** (SessionStart) - Notify when new Nori versions available
- **Desktop notifications** (Notification) - Alerts when Claude needs attention

### 4.2 Paid Tier Additional Hooks

- **Conversation summarization** (SessionEnd) - Automatically save conversation summaries to knowledge base
- **Pre-compact preservation** (PreCompact) - Preserve context before conversation compaction
- **Summarization notification** - User notification before async summarization

## 5. Knowledge Base (Paid Only)

Persistent memory and context across sessions, stored server-side.

### 5.1 Core Skills

- **Memorize** - Save important information to the knowledge base
- **Recall** - Search using full-text, fuzzy, and vector search

### 5.2 Automatic Conversation Tracking

- **SessionEnd hooks** - Automatically save conversation summaries when sessions end
- **PreCompact hooks** - Preserve context before Claude compacts the conversation
- All conversations become searchable for future reference

### 5.3 Organization Analytics

- Comprehensive usage metrics for your team
- Track collaboration patterns and knowledge sharing

## 6. Noridocs Documentation System

An opinionated documentation system with docs.md files in each folder.

### 6.1 Free Tier (Local)

- **Format:** Overview, How it fits, Core Implementation, Things to Know
- **Updates:** Manual via updating-noridocs skill
- **Storage:** Part of codebase, tracked in git
- **Initialize:** `/nori-init-docs` to generate throughout codebase

### 6.2 Paid Tier (Server-side)

- Everything in free tier, plus:
- **Server storage** with versioning
- **Skills:** read-noridoc, write-noridoc, list-noridocs
- **Automatic updates** via nori-change-documenter subagent

## 7. Status Line

Real-time display of conversation metrics in your Claude Code interface.

### 7.1 Displayed Metrics

- Git branch
- Active profile name (color-coded in yellow)
- Token usage and conversation costs
- Lines changed

### 7.2 Rotating Tips

- 30 tips cycling hourly
- Best practices and feature reminders

**Available in:** Free and Paid

## 8. CLAUDE.md Behavioral Instructions

Profile-specific instructions that guide Claude's behavior.

### 8.1 Features

- **Managed block pattern** - Safe updates without destroying user content
- **Dynamic skills list** - Auto-generated from installed skills
- **Profile-specific workflows** - Tone, autonomy, git behavior
- **Location:** `~/.claude/CLAUDE.md`

**Available in:** Free and Paid

## 9. Slash Commands

Custom commands available in Claude Code.

- `/nori-info` - Display this information (you're using it now!)
- `/nori-debug` - Validate Nori installation (`nori-ai check`)
- `/nori-install-location` - Display Nori installation directories
- `/nori-switch-profile` - Switch between profiles interactively
- `/nori-init-docs` - Generate documentation files throughout codebase

**Available in:** Free and Paid

## 10. Installation & Upgrade

### 10.1 Install (Free or Paid)

```bash
npm install -g nori-ai
nori-ai install
```

During installation, you'll be prompted for credentials. Press Enter to skip for free tier, or provide credentials for paid tier.

### 10.2 Upgrade to Paid

Visit [tilework.tech](https://tilework.tech) to get credentials, then reinstall:

```bash
nori-ai install
```

Provide your credentials when prompted.

### 10.3 Switch Profiles

```bash
nori-ai switch-profile
```

Or use the `/nori-switch-profile` slash command.

## 11. Troubleshooting

If you encounter installation issues, check the installer log file:

```bash
cat /tmp/nori-installer.log
```

This log contains detailed information about the installation process and any errors encountered.

For validation and debugging:

```bash
nori-ai check
```

Or use the `/nori-debug` slash command.
