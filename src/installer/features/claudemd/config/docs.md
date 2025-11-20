# Noridoc: config

Path: @/plugin/src/installer/features/claudemd/config

### Overview

This folder no longer contains CLAUDE.md templates. The claudemd feature now uses profile-based CLAUDE.md files stored in @/plugin/src/installer/features/profiles/config/{profile-name}/CLAUDE.md, selected based on the profile field in @/plugin/src/installer/config.ts.

### How it fits into the larger codebase

The claudemd loader at @/plugin/src/installer/features/claudemd/loader.ts reads CLAUDE.md content from profile directories in @/plugin/src/installer/features/profiles/config/ during installation. The loader uses the baseProfile field from Config.profile (defaults to 'senior-swe') to determine which profile's CLAUDE.md to load. Each profile directory (senior-swe, nontechnical, amol) contains a CLAUDE.md file with checklist-based instructions and a skills subdirectory with profile-specific skills. The loader appends a dynamically generated skills list to the CLAUDE.md content by scanning the profile's skills directory, then inserts the complete content into ~/.claude/CLAUDE.md within a managed block (marked with BEGIN NORI-AI MANAGED BLOCK / END NORI-AI MANAGED BLOCK). Profile switching via @/plugin/src/installer/features/profiles preserves authentication credentials while updating the profile field, then re-runs installation to regenerate ~/.claude/CLAUDE.md with the new profile's content and skills.

### Core Implementation

The loader's getProfileClaudeMd() function constructs the path to the selected profile's CLAUDE.md file. The generateSkillsList() function finds all SKILL.md files in the profile's skills directory using glob patterns, extracts front matter (name and description fields) from each skill, and formats them into a skills list section with tilde-notation paths ({{skills_dir}}/{skill-name}/SKILL.md). The skill name is derived from the directory containing SKILL.md, with any 'paid-' prefix stripped to match the actual installed path. The insertClaudeMd() function combines the profile's CLAUDE.md content with the generated skills list, then inserts or updates the managed block in ~/.claude/CLAUDE.md. Profile CLAUDE.md files contain plain markdown instructions without customization markers - each profile is a complete, standalone configuration. The three built-in profiles are senior-swe (asks before creating branches/worktrees, autonomous technical decisions, frequent commits), nontechnical (auto-creates worktrees, autonomous technical decisions, frequent commits), and amol (auto-creates worktrees, autonomous technical decisions, frequent commits). All profiles follow the same checklist structure: read skills system, check git status, research codebase, write plan, get approval, TDD workflow, update docs, finish branch, run linters/tests.

### Things to Know

This replaces the previous base-instructions.md approach which used HTML comment markers to customize a single template. The profile-based system removes the need for runtime customization logic - each profile is a complete, static file that can be edited directly. The loader still wraps profile content in managed blocks to enable updates without overwriting user customizations outside the block. Skills are profile-specific, allowing different profiles to have different skill sets. The skills list is dynamically generated rather than hardcoded, so adding new skills to a profile directory automatically includes them in the CLAUDE.md instructions. The extractFrontMatter() function parses YAML-style frontmatter from SKILL.md files to extract skill metadata. The loader preserves compatibility with the managed block system used by other features, ensuring all Nori-managed content can be cleanly updated or removed during install/uninstall operations.

---

Created and maintained by Nori.
