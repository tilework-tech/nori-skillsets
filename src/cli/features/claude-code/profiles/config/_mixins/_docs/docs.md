# Noridoc: _docs

Path: @/src/cli/features/claude-code/profiles/config/_mixins/_docs

### Overview

This directory contains mixin files for documentation workflows used by multiple Nori profiles. It provides shared subagent definitions and slash commands that profiles can incorporate to enable documentation features. The directory is part of the profile configuration system and uses the _mixins pattern to enable feature composition across profiles.

### How it fits into the larger codebase

This directory is consumed by @/src/cli/features/claude-code/profiles/ during profile installation. Profiles can reference mixins from this directory in their config to include documentation capabilities. The subagents defined here (particularly in @/src/cli/features/claude-code/profiles/config/_mixins/_docs/subagents/) are copied to ~/.claude/agents/ during installation by @/src/cli/features/claude-code/subagents/, allowing the main agent to delegate documentation tasks via the Task tool. The slash commands in @/src/cli/features/claude-code/profiles/config/_mixins/_docs/slashcommands/ are copied to ~/.claude/slash_commands/ by @/src/cli/features/claude-code/slashcommands/, enabling users to invoke documentation workflows with commands like /nori-init-docs and /update-noridocs.

### Core Implementation

The directory contains three subdirectories: subagents/, slashcommands/, and skills/. The subagents/ directory defines specialized documentation agents (nori-initial-documenter, nori-change-documenter) that use a **two-pass documentation approach**: first a top-down pass creates architectural documentation starting from high-level understanding, then a bottom-up pass verifies accuracy by starting from leaf directories and working upward to ensure all concrete implementation details are captured correctly. The slashcommands/ directory provides user-facing commands that invoke these subagents. The skills/ directory contains shared skills for documentation workflows like updating-noridocs/. All subagent files use YAML frontmatter with constrained tool sets (Read, Grep, Glob, LS, Write, Edit, Bash) and strict instructions prohibiting critique or improvement suggestions - they are "documentarians not critics" focused solely on describing what exists.

### Things to Know

The documentation subagents use a mandatory two-pass approach for comprehensive documentation: the top-down pass (Step 3) creates initial docs.md files based on architectural understanding, then the bottom-up pass (Step 3.5) verifies and corrects these files by starting with leaf directories and working upward through the directory tree. This ensures both high-level architectural context and accurate low-level implementation details. The bottom-up pass can UPDATE docs.md files created in the top-down pass, not just create new ones, prioritizing accuracy over initial assumptions. All documentation follows the Noridoc format with sections for Overview, How it fits into the larger codebase, Core Implementation, and Things to Know. Documentation subagents have strict anti-patterns: no brittle documentation (exhaustive lists, numeric counts, line numbers), no critique or suggestions, no evaluating code correctness. The _mixins pattern allows multiple profiles to share the same documentation capabilities without duplication. Documentation workflows integrate with the Recall/Memorize skills system for paid profiles.

Created and maintained by Nori.
