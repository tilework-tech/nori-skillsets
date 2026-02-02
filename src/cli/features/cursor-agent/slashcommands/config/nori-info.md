---
description: Display information about Nori Skillsets features and capabilities for Cursor
---

Please read the following information about Nori Skillsets for Cursor and provide a clear, concise summary to me. After your summary, state: "I loaded the nori documentation for Cursor. You can ask me for more help about how to use nori if you would like."

Suggest helpful follow-up questions like:

- "How do I switch between skillsets?"
- "What rules are available?"
- "How do I create a custom skillset?"

---

# Nori for Cursor Documentation

Nori enhances Cursor with better context management and specialized workflows through the AGENTS.md and rules system.

## 1. Skillset System

Skillsets control Cursor's behavior through AGENTS.md instructions and rules.

### 1.1 amol (Default)

- **Behavior:** Full autonomy with frequent commits
- **Worktrees:** Automatically creates worktrees
- **Commits/PRs:** Autonomous commits and PR creation
- **Best for:** Experienced users who want maximum productivity

### 1.2 Skillset Management

- **Switch skillsets:** `nori-skillsets switch-skillset --agent cursor-agent`
- **Custom skillsets:** Create your own in `{{profiles_dir}}/`
- **Source of truth:** All skillsets stored in `{{profiles_dir}}/`

## 2. Rules System

Rules are reusable workflow guidelines stored in `{{rules_dir}}/`. Unlike Claude Code's skills, rules are simpler markdown files that provide context and guidelines.

### 2.1 Available Rules

- **using-git-worktrees** - Guidelines for creating isolated workspaces

Rules are loaded into the AGENTS.md managed block during installation.

## 3. AGENTS.md Behavioral Instructions

Skillset-specific instructions that guide Cursor's behavior.

### 3.1 Features

- **Managed block pattern** - Safe updates without destroying user content
- **Skillset-specific workflows** - Tone, autonomy, git behavior
- **Location:** `~/.cursor/AGENTS.md`

## 4. Slash Commands

Custom commands available in Cursor.

- `/nori-info` - Display this information (you're using it now!)

## 5. Installation

### 5.1 Install

```bash
npx nori-skillsets init --agent cursor-agent
```

### 5.2 Switch Skillsets

```bash
nori-skillsets switch-skillset --agent cursor-agent
```

## 6. Troubleshooting

If you encounter installation issues, check the installer log file:

```bash
cat /tmp/nori-installer.log
```

For validation and debugging:

```bash
nori-skillsets check --agent cursor-agent
```

## 7. Key Differences from Claude Code

| Feature | Claude Code | Cursor |
|---------|------------|--------|
| Instructions file | CLAUDE.md | AGENTS.md |
| Workflows | Skills (SKILL.md) | Rules (RULE.md) |
| Config directory | ~/.claude | ~/.cursor |
| Hooks | Yes | Not yet |
| Status line | Yes | Not yet |
