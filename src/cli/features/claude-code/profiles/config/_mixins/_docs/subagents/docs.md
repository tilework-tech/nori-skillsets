# Noridoc: subagents (_docs mixin)

Path: @/src/cli/features/claude-code/profiles/config/_mixins/_docs/subagents

### Overview

This directory contains subagent definitions for documentation workflows, specifically nori-initial-documenter and nori-change-documenter. These subagents implement specialized documentation strategies with constrained tool access and strict instructions to document code without critique. Both use a two-pass documentation approach combining top-down architectural understanding with bottom-up accuracy verification.

### How it fits into the larger codebase

These subagent .md files are copied to ~/.claude/agents/ during profile installation by @/src/cli/features/claude-code/subagents/. The main agent invokes these subagents using the Task tool with a subagent_type parameter. The /nori-init-docs slash command (defined in @/src/cli/features/claude-code/profiles/config/_mixins/_docs/slashcommands/) invokes nori-initial-documenter, while /update-noridocs invokes nori-change-documenter. Both subagents integrate with the nori-sync-docs skill (from @/src/cli/features/claude-code/profiles/config/_mixins/_docs-paid/skills/nori-sync-docs/) to push documentation to remote servers. These subagents are referenced in profile CLAUDE.md files (like @/src/cli/features/claude-code/profiles/config/amol/CLAUDE.md) as part of the documentation workflow.

### Core Implementation

Both subagents use YAML frontmatter with tools: "Read, Grep, Glob, LS, Write, Edit, Bash" and model: inherit. The nori-initial-documenter implements a **mandatory two-pass documentation workflow**: Step 3 (Top-Down Pass) creates initial docs.md files by understanding architecture and working downward, then Step 3.5 (Bottom-Up Pass) verifies accuracy by identifying leaf directories (folders with source code but no child folders with source code) and working upward through the directory tree. The bottom-up pass uses Glob/LS to identify leaves, reads existing docs.md files created in Step 3, and updates them for accuracy, correcting any missed details or inaccuracies from the top-down pass. For parent directories, it reads ALL child docs.md files to ensure parent documentation accurately describes relationships and architectural context. The nori-change-documenter focuses on analyzing git diffs and updating docs.md files in changed folders. Both subagents use TodoWrite to track their workflow steps and follow the Noridoc format (Overview, How it fits into the larger codebase, Core Implementation, Things to Know sections).

### Things to Know

The two-pass approach in nori-initial-documenter is always mandatory when using /nori-init-docs (not optional). The bottom-up pass (Step 3.5) can UPDATE docs.md files created during the top-down pass (Step 3) if inaccuracies are found. The key principle is that bottom-up prioritizes ACCURACY - if top-down documentation missed something or was incorrect, it gets corrected during bottom-up traversal. Parent folders get docs.md files even if they contain no direct source code, to provide architectural context for their children. Both subagents have strict constraints: they must NEVER suggest improvements, perform root cause analysis, critique implementation, or evaluate code quality - they are "documentarians not critics". The subagents follow anti-brittle documentation guidelines: no exhaustive lists of files/functions, no numeric counts, no line numbers. They use filepath links extensively and focus on "why" over "what/how". The bottom-up pass ensures every folder with source code has a docs.md file, addressing a common gap where top-down approaches miss leaf directories. Changes to these subagent definitions require profiles to be reinstalled and Claude Code to be restarted.

Created and maintained by Nori.
