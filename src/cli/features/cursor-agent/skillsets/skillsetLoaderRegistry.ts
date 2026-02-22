/**
 * Cursor profile loader registry for profile-dependent feature installation
 * Singleton registry that manages loaders for features that depend on profile composition
 */

import { agentsMdLoader } from "@/cli/features/cursor-agent/skillsets/agentsmd/loader.js";
import { skillsLoader } from "@/cli/features/cursor-agent/skillsets/skills/loader.js";
import { slashCommandsLoader } from "@/cli/features/cursor-agent/skillsets/slashcommands/loader.js";
import { subagentsLoader } from "@/cli/features/cursor-agent/skillsets/subagents/loader.js";

import type { Config } from "@/cli/config.js";
import type { Skillset } from "@/cli/features/skillset.js";

/**
 * Profile loader interface for Cursor profile-dependent feature installation
 */
export type CursorProfileLoader = {
  name: string;
  description: string;
  install: (args: { config: Config; skillset: Skillset }) => Promise<void>;
};

/**
 * Registry singleton for managing Cursor profile loaders
 */
export class CursorProfileLoaderRegistry {
  private static instance: CursorProfileLoaderRegistry | null = null;
  private loaders: Map<string, CursorProfileLoader>;

  private constructor() {
    this.loaders = new Map();

    // Register all profile loaders
    // Order matters: skills must be installed before agentsmd (which reads from skills)
    this.loaders.set(skillsLoader.name, skillsLoader);
    this.loaders.set(agentsMdLoader.name, agentsMdLoader);
    this.loaders.set(slashCommandsLoader.name, slashCommandsLoader);
    this.loaders.set(subagentsLoader.name, subagentsLoader);
  }

  /**
   * Get the singleton instance
   * @returns The CursorProfileLoaderRegistry singleton instance
   */
  public static getInstance(): CursorProfileLoaderRegistry {
    if (CursorProfileLoaderRegistry.instance == null) {
      CursorProfileLoaderRegistry.instance = new CursorProfileLoaderRegistry();
    }
    return CursorProfileLoaderRegistry.instance;
  }

  /**
   * Get all registered profile loaders
   * @returns Array of all profile loaders
   */
  public getAll(): Array<CursorProfileLoader> {
    return Array.from(this.loaders.values());
  }
}
