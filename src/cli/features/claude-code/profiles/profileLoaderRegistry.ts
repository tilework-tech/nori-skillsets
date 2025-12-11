/**
 * Profile loader registry for profile-dependent feature installation
 * Singleton registry that manages loaders for features that depend on profile composition
 */

import { claudeMdLoader } from "@/cli/features/claude-code/profiles/claudemd/loader.js";
import { skillsLoader } from "@/cli/features/claude-code/profiles/skills/loader.js";
import { slashCommandsLoader } from "@/cli/features/claude-code/profiles/slashcommands/loader.js";
import { subagentsLoader } from "@/cli/features/claude-code/profiles/subagents/loader.js";

import type { Config } from "@/cli/config.js";
import type { ValidationResult } from "@/cli/features/agentRegistry.js";

/**
 * Profile loader interface for profile-dependent feature installation
 * Uses 'install' instead of 'run' to distinguish from main loaders
 */
export type ProfileLoader = {
  name: string;
  description: string;
  install: (args: { config: Config }) => Promise<void>;
  uninstall: (args: { config: Config }) => Promise<void>;
  validate?: (args: { config: Config }) => Promise<ValidationResult>;
};

/**
 * Registry singleton for managing profile loaders
 */
export class ProfileLoaderRegistry {
  private static instance: ProfileLoaderRegistry | null = null;
  private loaders: Map<string, ProfileLoader>;

  private constructor() {
    this.loaders = new Map();

    // Register all profile loaders
    // Order matters: skills must be installed before claudemd (which reads from skills)
    this.loaders.set(skillsLoader.name, skillsLoader);
    this.loaders.set(claudeMdLoader.name, claudeMdLoader);
    this.loaders.set(slashCommandsLoader.name, slashCommandsLoader);
    this.loaders.set(subagentsLoader.name, subagentsLoader);
  }

  /**
   * Get the singleton instance
   * @returns The ProfileLoaderRegistry singleton instance
   */
  public static getInstance(): ProfileLoaderRegistry {
    if (ProfileLoaderRegistry.instance == null) {
      ProfileLoaderRegistry.instance = new ProfileLoaderRegistry();
    }
    return ProfileLoaderRegistry.instance;
  }

  /**
   * Get all registered profile loaders
   * @returns Array of all profile loaders
   */
  public getAll(): Array<ProfileLoader> {
    return Array.from(this.loaders.values());
  }

  /**
   * Get all registered profile loaders in reverse order (for uninstall)
   * @returns Array of all profile loaders in reverse order
   */
  public getAllReversed(): Array<ProfileLoader> {
    return Array.from(this.loaders.values()).reverse();
  }
}
