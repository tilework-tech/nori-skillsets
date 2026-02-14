# Implementation Epic: Multi-Agent Skillset Support

Parent RFC: [multi-agent-support.md](./multi-agent-support.md)

## Overview

This epic breaks the multi-agent design into deliverable work streams. Each work
stream is independent enough to be developed and merged separately, though some
have ordering dependencies noted below.

---

## Work Stream 1: Canonical Profile Format

**Goal:** Establish the agent-neutral profile format that all downstream work
builds on.

**Scope:**

- Add `INSTRUCTIONS.md` as the canonical instructions filename
- Add backwards-compatibility: when `INSTRUCTIONS.md` is not found, fall back to
  `CLAUDE.md` and treat it as Claude-dialect canonical
- Extend `nori.json` schema with the `agents` field (`supported` array,
  `overrides` object)
- Extend `.nori-config.json` schema: profile becomes top-level with
  `baseProfile` string and `agents` array, replacing the current
  `agents[agentName].profile` nesting
- Migrate the built-in `senior-swe` profile metadata to the new schema (content
  stays as-is — no skill rewrites)

**Dependencies:** None. This is the foundation.

**Validation:** Existing `nori-skillsets install` for Claude Code still works
identically after these changes. The new fields are additive.

---

## Work Stream 2: ContentCompiler

**Goal:** Build the shared content translation engine.

**Scope:**

- Define the `ContentCompilerConfig` type: vocabulary map, tag mappings,
  feature degradation rules, translation strategy
- Implement the four-stage pipeline:
  1. Tool vocabulary substitution (context-aware — skip code blocks)
  2. Tag adaptation (XML tag open/close mapping)
  3. Feature degradation (subagent/command references to workflow tips)
  4. Template variable resolution (extend existing `template.ts`)
- Define vocabulary and tag mappings for three agents:
  - Claude Code (identity mapping — pass-through, since canonical is
    backwards-compatible with Claude dialect)
  - Codex (tool name swaps, tags preserved)
  - Cursor (generic tool terms, tag style adaptation for `full` strategy)
- Implement both `minimal` and `full` strategies as swappable config, not
  branching logic
- Handle edge cases: tool names inside code blocks, tool names as substrings of
  other words, nested XML tags

**Dependencies:** Work Stream 1 (needs canonical format to know what it's
compiling).

**Validation:**
- Unit tests: given known input markdown + agent + strategy, assert expected
  output
- Snapshot tests: compile the existing `senior-swe` skills for each agent and
  review output manually to confirm quality
- Regression: Claude Code output from the compiler matches current installed
  output (identity transform)

---

## Work Stream 3: Agent Capabilities Traits

**Goal:** Define the trait interfaces and implement shared building blocks.

**Scope:**

- Define trait function types: `ResolvePaths`, `InstallInstructions`,
  `InstallSkill`, `InstallSubagent`, `InstallSlashCommand`,
  `InstallAgentConfig`
- Define the `AgentCapabilities` composition type
- Implement shared trait functions:
  - `copyDirectorySkillInstaller` — used by Claude, Codex
  - `managedBlockInstructionsInstaller` — used by Claude, Codex
  - `mdcRuleSkillInstaller` — used by Cursor
  - `mdcRuleInstructionsInstaller` — used by Cursor
  - `copyFileSubagentInstaller` — used by Claude
  - `copyFileCommandInstaller` — used by Claude
- Implement path resolvers for each agent:
  - Claude: `.claude/`, `CLAUDE.md`, `skills/`, `agents/`, `commands/`,
    `settings.json`
  - Codex: `.codex/`, `AGENTS.md`, `skills/`
  - Cursor: `.cursor/`, `rules/` (`.mdc` files), `skills/nori/`

**Dependencies:** None (trait types are standalone). Integration with the
pipeline (Work Stream 5) comes later.

**Validation:** Each trait function is unit-testable in isolation — given
compiled content and a temp directory, assert correct file placement, format,
and content.

---

## Work Stream 4: Agent-Specific Implementations

**Goal:** Wire up the three concrete agents with their capabilities and compiler
configs.

**Scope:**

- **Claude Code agent:**
  - Compose capabilities from existing shared traits
  - `installAgentConfig`: refactor current `hooksLoader`,
    `statuslineLoader`, `announcementsLoader` into a single trait
    implementation that merges into `settings.json`
  - Compiler config: identity vocabulary (pass-through), both strategies
    available

- **Codex agent:**
  - Compose capabilities: `managedBlockInstructionsInstaller`,
    `copyDirectorySkillInstaller`, codex-specific `installAgentConfig`
    (writes to TOML config)
  - Compiler config: Codex vocabulary map (`TodoWrite` -> `update_plan`,
    etc.)
  - Subagent and slash command traits: determine support level. If Codex
    supports equivalents, implement. Otherwise, null (degraded in content
    layer).

- **Cursor agent:**
  - Compose capabilities: `mdcRuleInstructionsInstaller`,
    `mdcRuleSkillInstaller`, null for subagents/commands/settings
  - Compiler config: Cursor vocabulary map (generic tool terms), full
    strategy tag mappings
  - `.mdc` frontmatter generation: derive `description` from skill
    frontmatter, apply `alwaysApply` / `globs` from `nori.json` overrides

**Dependencies:** Work Streams 2 and 3 (needs compiler and trait building
blocks).

**Validation:**
- Install `senior-swe` profile for each agent into a temp directory
- Assert output structure matches expected layout per agent
- Claude Code output is backwards-compatible with current installation

---

## Work Stream 5: Install Pipeline Refactor

**Goal:** Replace the current LoaderRegistry pattern with the generic
trait-based pipeline.

**Scope:**

- Implement the generic `installProfile` orchestrator function that:
  1. Builds a compiler from the agent's config
  2. Iterates canonical profile content (instructions, skills, subagents,
     commands)
  3. Compiles each piece of content
  4. Invokes the corresponding trait (skipping nulls)
  5. Invokes `installAgentConfig` if present
- Refactor the `install` command to use the new pipeline instead of
  `agent.getLoaderRegistry().getAll()` sequential execution
- Preserve the shared infra step (config loading, auth, profile resolution)
  outside the pipeline
- Preserve the manifest write step after the pipeline
- Remove the old `LoaderRegistry` and per-agent loader files once the new
  pipeline is validated

**Dependencies:** Work Streams 1-4 (all pieces must exist to assemble the
pipeline).

**Validation:**
- `nori-skillsets install` for Claude Code produces identical output to the
  current implementation
- `nori-skillsets install --agent codex` produces correct Codex output
- `nori-skillsets install --agent cursor` produces correct Cursor output
- `nori-skillsets switch-skillset` works through the new pipeline

---

## Work Stream 6: CLI Ergonomics

**Goal:** Update the CLI interface for multi-agent workflows.

**Scope:**

- **Default install dir:** Change default from `~/.claude` to `.` (cwd).
  Preserve `--install-dir` override.
- **Multiple agent flags:** Accept `-a` / `--agent` as a repeatable flag
  (array). Commands that use it: `install`, `switch-skillset`,
  `list-skillsets`.
- **Agent auto-detection:** When no `--agent` flag is provided, scan the
  install directory for known agent directories (`.claude/`, `.codex/`,
  `.cursor/`) and agent-specific files. Install for all detected agents.
  - On fresh install (no agents detected), fall back to prompting or a
    sensible default (Claude Code only, or prompt user).
- **Config schema migration:** Handle existing `.nori-config.json` files
  with the old `agents[agentName].profile` structure. Migrate on read to
  the new top-level `profile` structure. Write new format on save.
- **Revised `AgentName` type:** Extend from `"claude-code"` to
  `"claude-code" | "codex" | "cursor"`.

**Dependencies:** Work Stream 5 (pipeline must support multi-agent before CLI
exposes it).

**Validation:**
- `nori-skillsets install` in a project with `.claude/` and `.cursor/`
  installs for both agents
- `nori-skillsets install -a claude-code -a codex` installs for exactly those
  two agents
- `nori-skillsets install --install-dir ~/` installs to home directory
- Existing configs with old schema are migrated transparently

---

## Work Stream 7: AgentRegistry Revision

**Goal:** Update the registry to work with the new `AgentDefinition` type.

**Scope:**

- Replace the current `Agent` type (class-like, with `getLoaderRegistry`) with
  `AgentDefinition` (name, displayName, capabilities, compilerConfig)
- Register all three agents in the registry
- Update all call sites that look up agents from the registry
- Remove the old `LoaderRegistry` type and related code

**Dependencies:** Work Streams 4 and 5 (agents must be defined and pipeline
must be ready).

**Validation:** All existing commands work. `AgentRegistry.list()` returns
all three agents.

---

## Ordering and Parallelism

```
Work Stream 1 (Canonical Format)
  |
  v
Work Stream 2 (ContentCompiler)    Work Stream 3 (Traits)
  |                                  |
  +------ both feed into -----------+
  |
  v
Work Stream 4 (Agent Implementations)
  |
  v
Work Stream 5 (Pipeline Refactor)
  |
  v
Work Stream 6 (CLI Ergonomics)     Work Stream 7 (Registry Revision)
```

Work Streams 2 and 3 can proceed in parallel once 1 is done.
Work Streams 6 and 7 can proceed in parallel once 5 is done.

## Risk Areas

**Cursor `.mdc` generation quality.** We have limited real-world data on how
Cursor's agent model responds to different rule formats. The `full` translation
strategy for Cursor may need iteration based on testing. Mitigation: start with
`minimal`, observe behavior, tune.

**Codex tool and config surface.** Codex is newer and its configuration surface
may change. The `installAgentConfig` trait for Codex (TOML config) is the most
likely to need updates as Codex evolves. Mitigation: keep the trait
implementation thin and isolated.

**ContentCompiler false positives.** Regex-based tool name matching in prose
can produce false positives (e.g., "Read" as a common English word vs the `Read`
tool). Mitigation: match tool names with boundary conditions, skip code blocks,
and maintain a manual review step during initial rollout.

**Backwards compatibility during migration.** Existing users have
`.nori-config.json` files with the old schema. The config migration (Work Stream
6) must handle this transparently. Mitigation: read-time migration with old
format support preserved for at least one major version.

## Out of Scope

- Full rewrite of existing skill content to agent-neutral format (existing
  Claude-dialect content is handled by backwards compatibility)
- A/B testing infrastructure for translation strategies (manual comparison for
  now)
- Compiler output caching
- Agents beyond Claude Code, Codex, and Cursor
- Interactive UI for agent detection confirmation (future enhancement)
