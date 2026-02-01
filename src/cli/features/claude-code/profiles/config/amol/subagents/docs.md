# Noridoc: subagents (amol)

Path: @/src/cli/features/claude-code/profiles/config/amol/subagents

### Overview

This directory contains subagent definitions inlined directly in the amol profile. Subagents are specialized AI assistants that can be invoked via the Task tool for focused work like documentation, codebase analysis, and web research.

### How it fits into the larger codebase

These subagent .md files are copied to ~/.claude/agents/ during profile installation by @/src/cli/features/claude-code/profiles/subagents/loader.ts.

### Core Implementation

Each subagent file uses YAML frontmatter with `tools` (constrained tool list) and `model: inherit`. Documentation subagents implement a two-pass documentation workflow (top-down then bottom-up) for comprehensive coverage.

### Things to Know

**Self-contained**: All subagents are inlined directly in this profile directory. No mixin composition or inheritance.

**Documentation subagent constraints**: Documentation subagents are "documentarians not critics" - they document what exists without suggesting improvements.

Created and maintained by Nori.
