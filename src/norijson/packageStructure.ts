/**
 * Package structure definitions
 *
 * Declares the expected filesystem layout for each NoriJson package type.
 * This is the single source of truth for what a skillset (or skill) looks
 * like on disk.
 */

import type { NoriJsonType } from "@/norijson/nori.js";

/**
 * A single structural component within a package.
 */
export type PackageComponent = {
  /** Relative path from package root (e.g., "skills", "CLAUDE.md") */
  path: string;
  /** Whether this component is required or optional */
  required: boolean;
  /** What kind of filesystem entry this is */
  kind: "file" | "directory";
  /** Human-readable description of what this component contains */
  description: string;
  /** For directories: glob pattern describing expected children */
  childPattern?: string | null;
};

/**
 * The expected filesystem structure for a given package type.
 */
export type PackageStructure = {
  type: NoriJsonType;
  description: string;
  components: Array<PackageComponent>;
};

/**
 * Structure definition for a skillset package.
 */
export const skillsetStructure: PackageStructure = {
  type: "skillset",
  description:
    "A skillset containing skills, subagents, slash commands, and a CLAUDE.md",
  components: [
    {
      path: "CLAUDE.md",
      required: false,
      kind: "file",
      description: "Profile-level instructions injected into Claude Code",
    },
    {
      path: "skills",
      required: false,
      kind: "directory",
      description: "Skill directories, each containing a SKILL.md",
      childPattern: "*/SKILL.md",
    },
    {
      path: "subagents",
      required: false,
      kind: "directory",
      description: "Subagent definition files (.md)",
      childPattern: "*.md",
    },
    {
      path: "slashcommands",
      required: false,
      kind: "directory",
      description: "Slash command definition files (.md)",
      childPattern: "*.md",
    },
    {
      path: "nori.json",
      required: true,
      kind: "file",
      description: "Package manifest",
    },
  ],
};

/**
 * Structure definition for a skill package.
 */
export const skillStructure: PackageStructure = {
  type: "skill",
  description: "A single skill with a SKILL.md and optional scripts",
  components: [
    {
      path: "SKILL.md",
      required: true,
      kind: "file",
      description: "Skill definition with frontmatter (name, description)",
    },
    {
      path: "nori.json",
      required: false,
      kind: "file",
      description: "Package manifest (may be auto-generated on upload)",
    },
  ],
};

/**
 * Registry mapping package types to their structure definitions.
 */
export const packageStructures: Record<string, PackageStructure> = {
  skillset: skillsetStructure,
  skill: skillStructure,
};

/**
 * Look up the structure definition for a package type.
 *
 * @param args - Function arguments
 * @param args.type - The NoriJson package type to look up
 *
 * @returns The structure definition, or null if none is defined for this type
 */
export const getPackageStructure = (args: {
  type: NoriJsonType;
}): PackageStructure | null => {
  const { type } = args;
  return packageStructures[type] ?? null;
};
