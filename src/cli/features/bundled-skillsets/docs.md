# Noridoc: bundled-skillsets

Path: @/src/cli/features/bundled-skillsets

### Overview

- Provides skills that are automatically included in every skillset installation, regardless of which skillset is active
- Currently bundles a single `nori-info` skill that gives agents pointers to CLI help, docs site, GitHub repo, and company homepage
- Shared across all agent implementations (claude-code and cursor-agent)

### How it fits into the larger codebase

- Both agent skill loaders (@/src/cli/features/claude-code/skillsets/skills/loader.ts and @/src/cli/features/cursor-agent/skillsets/skills/loader.ts) call `copyBundledSkills()` after copying skillset-provided skills
- The CLAUDE.md generator (@/src/cli/features/claude-code/skillsets/claudemd/loader.ts) calls `getBundledSkillsDir()` to scan bundled skills and include them in the skills list written to CLAUDE.md
- Bundled skill files are stored as static assets at `@/src/cli/features/bundled-skillsets/skills/` alongside the installer module
- Template substitution from @/src/cli/features/template.ts is applied to markdown files during copy, so bundled skills can use `{{skills_dir}}` and other placeholders

### Core Implementation

- `installer.ts` exports two functions:
  - `copyBundledSkills({ destSkillsDir, installDir })` -- copies each skill subdirectory from the bundled skills directory to the destination. Skips any skill whose name already exists at the destination (skillset-provided skills take precedence). Uses `fs.access()` to check existence before copying.
  - `getBundledSkillsDir()` -- returns the absolute path to the bundled skills directory, used by the CLAUDE.md generator to discover bundled skills for the skills list
- `copyDirWithTemplateSubstitution()` is a private helper that recursively copies a directory, applying `substituteTemplatePaths()` to `.md` files and doing a plain `fs.copyFile()` for everything else

### Things to Know

- **Skillset skills always win**: If a skillset provides a skill with the same directory name as a bundled skill, the bundled skill is not copied. This is enforced by checking `fs.access(destPath)` before copying -- if the path exists (placed there by the skillset skill loader which runs first), the bundled skill is skipped.
- **Silent failure on missing bundled directory**: If the bundled skills directory cannot be read (e.g., missing in development), `copyBundledSkills` returns silently rather than throwing.
- **Extensible directory structure**: New bundled skills can be added by creating subdirectories under `@/src/cli/features/bundled-skillsets/skills/`. Each subdirectory must contain a `SKILL.md` file to be recognized by the skills list generator.

Created and maintained by Nori.
