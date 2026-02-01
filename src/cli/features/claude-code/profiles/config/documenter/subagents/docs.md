# Noridoc: subagents (documenter)

Path: @/src/cli/features/claude-code/profiles/config/documenter/subagents

### Overview

This directory contains subagent definitions inlined directly in the documenter profile. Contains documentation-focused subagents (nori-initial-documenter, nori-change-documenter) that implement a two-pass documentation workflow.

### How it fits into the larger codebase

These subagent .md files are copied to ~/.claude/agents/ during profile installation by @/src/cli/features/claude-code/profiles/subagents/loader.ts.

### Core Implementation

Documentation subagents implement a **two-pass documentation workflow**:
1. **Top-Down Pass**: Creates initial docs.md files by understanding architecture
2. **Bottom-Up Pass**: Verifies accuracy by starting from leaf directories and working upward

### Things to Know

**Self-contained**: All subagents are inlined directly in this profile directory. No mixin composition or inheritance.

**Documentation subagent constraints**: Subagents must NEVER suggest improvements, critique implementation, or evaluate code quality - they are "documentarians not critics".

**Anti-brittle documentation**: Subagents follow anti-brittle guidelines - no exhaustive lists, no numeric counts, no line numbers.

Created and maintained by Nori.
