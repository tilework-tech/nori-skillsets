/**
 * Skillset content type definitions for Claude Code skillsets
 *
 * These types represent the inlined content discovered from a skillset directory.
 * They are used as fields within the unified NoriJson type.
 */

export type SkillsetSkill = {
  id: string; // directory name
  name: string; // from SKILL.md frontmatter
  description: string; // from SKILL.md frontmatter
  scripts?: Array<string> | null; // list of script filenames (e.g., ["script.ts", "setup.sh"])
};

export type SkillsetSlashCommand = {
  command: string; // e.g., "nori-debug" (without slash prefix)
  description: string; // from .md frontmatter
};

export type SkillsetSubagent = {
  id: string; // filename without .md
  name: string; // from .md frontmatter
  description: string; // from .md frontmatter
};
