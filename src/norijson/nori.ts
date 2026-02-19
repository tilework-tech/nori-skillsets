/**
 * Unified manifest type for Nori skillsets and skills
 *
 * The nori.json format is used by both skillsets and skills.
 */

import type {
  SkillsetSkill,
  SkillsetSubagent,
  SkillsetSlashCommand,
} from "@/norijson/skillset.js";

/**
 * The type of package this nori.json represents
 */
export type NoriJsonType = "skillset" | "skill" | "inlined-skill";

/**
 * Dependencies section of nori.json
 */
export type NoriJsonDependencies = {
  skills?: Record<string, string> | null; // skill name -> version range
  subagents?: Record<string, string> | null; // future use
  slashCommands?: Record<string, string> | null; // future use
};

/**
 * The unified nori.json manifest format
 *
 * This type serves as the single manifest type for both skillsets and skills.
 * - name and version are required
 * - Skillset content (skills, subagents, slashcommands) are optional top-level fields
 * - Skill-specific content (scripts) is an optional top-level field
 */
export type NoriJson = {
  name: string;
  version: string;
  author?: string | null;
  description?: string | null;
  license?: string | null;
  keywords?: Array<string> | null;
  repository?: string | null;
  dependencies?: NoriJsonDependencies | null;
  // Skillset content (inlined at top level)
  skills?: Array<SkillsetSkill> | null;
  subagents?: Array<SkillsetSubagent> | null;
  slashcommands?: Array<SkillsetSlashCommand> | null;
  // Skill content
  scripts?: Array<string> | null;
  // Package type
  type?: NoriJsonType | null;
  // Server-set metadata
  registryURL?: string | null;
  [key: string]: unknown; // Allow additional fields
};

export type {
  PackageComponent,
  PackageStructure,
} from "@/norijson/packageStructure.js";
export {
  packageStructures,
  getPackageStructure,
  skillsetStructure,
  skillStructure,
} from "@/norijson/packageStructure.js";
