# RFC: Multi-Agent Skillset Support

## Status

Draft

## Summary

Extend nori-skillsets to support multiple coding agents — starting with Claude
Code, OpenAI Codex, and Cursor — from a single canonical profile format.
Profiles are authored once and compiled to each agent's native configuration at
install time.

## Motivation

Today, nori-skillsets is tightly coupled to Claude Code. Every profile, skill,
subagent, slash command, and hook is written in Claude's dialect and installed to
Claude's directory structure. As the coding agent ecosystem grows, teams want to
use the same workflows across multiple agents without maintaining parallel
configurations.

The goal is to let a single Nori profile produce correct, idiomatic
configuration for any supported agent — with graceful degradation for features
an agent doesn't support.

## Design Principles

### 1. Write once, compile per-agent

A profile author writes one set of instructions and skills in Nori's canonical
format. The installer translates content and places files according to each
agent's conventions. No per-agent authoring is required.

### 2. Agent-neutral canonical format, backwards-compatible with Claude

The canonical format is agent-neutral going forward. Existing Claude-specific
content (XML tags like `<required>`, tool names like `TodoWrite`) is recognized
as "Claude-dialect canonical" and translated automatically. No forced migration
of existing profiles.

### 3. Graceful degradation over silent failure

When a feature has no equivalent in a target agent (e.g., subagents for Cursor),
the system degrades gracefully — inlining workflow tips into the instructions
rather than silently dropping capabilities. Agent Skills, supported by all
current platforms, serve as the portability layer.

### 4. Trait-oriented composition over class hierarchies

Agent implementations are composed from independent, testable trait functions
rather than inheriting from base classes. An agent declares only the
capabilities it supports. No stub implementations, no forced interface
compliance.

### 5. Project-local installation is primary

All agents support project-level installation (`.claude/`, `.codex/`, `.cursor/`
in the repo root). Some agents additionally support global home-directory
installation. The CLI defaults to the current working directory.

## Architecture

### Canonical Profile Format

The Nori profile is the single source of truth:

```
.nori/profiles/senior-swe/
  INSTRUCTIONS.md          # Agent-neutral instructions (replaces CLAUDE.md)
  profile.json             # Name, description, builtin flag
  nori.json                # Dependencies, agent compatibility metadata
  skills/
    writing-plans/
      SKILL.md             # Unchanged — existing skills work as-is
  subagents/
    knowledge-researcher.md
  slashcommands/
    commit.md
```

`INSTRUCTIONS.md` replaces `CLAUDE.md` as the canonical name. Existing profiles
with `CLAUDE.md` are treated as Claude-dialect canonical and still work.

`nori.json` gains an `agents` field for per-agent overrides:

```json
{
  "name": "senior-swe",
  "version": "1.0.3",
  "agents": {
    "supported": ["claude-code", "codex", "cursor"],
    "overrides": {
      "cursor": {
        "excludeFeatures": ["subagents", "slashcommands"],
        "includeSkills": ["*"],
        "ruleType": "always_apply"
      }
    }
  },
  "dependencies": { ... }
}
```

### Two-Layer Compiler

Translation separates into two independent concerns:

**Layer 1: ContentCompiler** — Transforms markdown text.

Sequential pipeline:
1. Tool vocabulary substitution (tool name references)
2. Tag adaptation (XML-style prompt engineering markers)
3. Feature degradation (subagent/command references become workflow tips)
4. Template variable resolution (path placeholders)

Supports two strategies, switchable per-agent for A/B testing:
- **Minimal**: Swap tool names to generic terms, leave XML tags as-is, drop
  unsupported feature references
- **Full**: Agent-optimized re-prompting — adapt tags to each agent's preferred
  idiom, restructure prose for the agent's token/tool-call patterns

Both strategies share the same pipeline; they differ in the vocabulary and tag
mappings provided. This lets us test which approach produces better agent
behavior before committing to one at scale.

The compiler must be context-aware when matching tool references — skip code
blocks, match only in prose context — to avoid false positive substitutions.

**Layer 2: Agent Capabilities (trait composition)** — Places files in the right
locations and formats.

Each capability is an independent function. Agents compose the set they support:

```
Public traits (driven by skillset content):
  resolvePaths         — Returns agent-specific directory structure
  installInstructions  — Writes compiled instructions to the right file/format
  installSkill         — Writes compiled skill content in agent-native format
  installSubagent      — Writes subagent definitions (null if unsupported)
  installSlashCommand  — Writes slash commands (null if unsupported)

Internal trait (Nori integration plumbing):
  installAgentConfig   — Modifies agent's primary config file
```

The `installAgentConfig` trait is internal to Nori. It manages integration
points like hooks, status line, and co-author attribution by modifying each
agent's native config file (`settings.json` for Claude, `config.toml` for
Codex, etc.). This trait:

- Is NOT driven by skillset content
- Is NOT exposed to profile authors
- Is the least stable surface — each agent's config format is different
  and subject to upstream changes
- Requires per-agent bespoke implementations (no shared building blocks)

### Shared Trait Implementations

Agents compose from reusable building blocks where behavior overlaps:

| Implementation | Used by | Behavior |
|---|---|---|
| `copyDirectorySkillInstaller` | Claude, Codex | Copy skill directory structure as-is |
| `mdcRuleSkillInstaller` | Cursor | Flatten skill to `.mdc` file with frontmatter |
| `managedBlockInstructionsInstaller` | Claude, Codex | Write instructions with managed block markers |
| `mdcRuleInstructionsInstaller` | Cursor | Write as `alwaysApply: true` `.mdc` rule |

### Install Pipeline

A single generic orchestrator replaces the current per-agent LoaderRegistry
pattern. The pipeline is agent-agnostic; trait implementations provide
agent-specific behavior:

```
1. Shared infra      — Load config, authenticate, resolve profile
2. Look up agent     — Get capabilities + compiler config from registry
3. Install pipeline  — Compile + invoke each trait (skip nulls)
4. Write manifest    — For change detection on profile switch
5. Display result
```

The current Claude Code loaders (configLoader, skillsLoader, claudeMdLoader,
hooksLoader, statuslineLoader, etc.) decompose into this model — each becomes
either a shared trait implementation or part of `installAgentConfig`.

### Per-Agent Output

For a project installing `senior-swe` across all three agents:

```
my-project/
  .claude/
    CLAUDE.md                    # Managed block, Claude vocabulary
    skills/writing-plans/SKILL.md
    agents/knowledge-researcher.md
    commands/commit.md
    settings.json                # Hooks, statusline, announcements
  .codex/
    AGENTS.md                    # Managed block, Codex vocabulary
    skills/writing-plans/SKILL.md
  .cursor/
    rules/
      nori-instructions.mdc      # alwaysApply: true
      nori-writing-plans.mdc     # agent-decided, description from skill
      ...
    skills/
      nori/SKILL.md              # Degraded workflow tips
```

## CLI Ergonomics

### Install directory

Defaults to the current working directory. Explicitly overridable with
`--install-dir`.

```
nori-skillsets install                    # installs to ./
nori-skillsets install --install-dir ~/   # installs to home dir (global)
```

### Profile is top-level, not per-agent

One profile is active at a time. The profile specifies which agents it targets:

```json
{
  "profile": {
    "baseProfile": "senior-swe",
    "agents": ["claude-code", "codex", "cursor"]
  }
}
```

This avoids confusion from having different skillsets active for different agents
in the same project.

### Multiple agent flags

Commands accept multiple `-a` / `--agent` flags to operate on a subset of
agents:

```
nori-skillsets install -a claude-code -a cursor
nori-skillsets switch-skillset -a cursor --profile product-designer
```

### Auto-detection without flags

When no `--agent` flag is provided, the CLI detects agents present in the
project by scanning for known directories and files (`.claude/`, `.codex/`,
`.cursor/`). The install runs for all detected agents.

Future enhancement: the interactive UI can prompt the user to confirm or filter
the detected list before proceeding.

## Decision Log

| Decision | Rationale |
|---|---|
| Single canonical format, not per-agent authoring | Avoid N-way maintenance burden as agent count grows |
| Agent-neutral format, backwards-compatible with Claude | Pragmatic — don't force rewrite of existing profiles |
| Compile at install time, no caching | Files are small, translation is instant, avoids stale cache bugs |
| Trait composition over class hierarchy | Independent testability, no forced stub implementations, flexible composition |
| Two translation strategies (minimal / full) | Need empirical data on which produces better agent behavior before committing |
| `installAgentConfig` is internal-only | Agent config surfaces are unstable and bespoke; not safe to expose to skillset authors |
| Graceful degradation via Agent Skills + workflow tips | All platforms support Agent Skills; tips preserve awareness of capabilities even when native support is absent |
| Project-local install as default | More useful for most use cases; global install is opt-in via `--install-dir` |
| Profile is top-level, not per-agent | One active profile per project avoids user confusion from mixed skillsets |
| Auto-detect agents when no flag provided | Sensible default for multi-agent projects; reduces friction |
