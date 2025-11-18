/**
 * Loader registry for feature installation
 * Singleton registry that manages all feature loaders
 */

import { claudeMdLoader } from "@/installer/features/claudemd/loader.js";
import { hooksLoader } from "@/installer/features/hooks/loader.js";
import { profilesLoader } from "@/installer/features/profiles/loader.js";
import { skillsLoader } from "@/installer/features/skills/loader.js";
import { slashCommandsLoader } from "@/installer/features/slashcommands/loader.js";
import { statuslineLoader } from "@/installer/features/statusline/loader.js";
import { subagentsLoader } from "@/installer/features/subagents/loader.js";

import type { Config } from "@/installer/config.js";

/**
 * Result of validation check
 */
export type ValidationResult = {
  valid: boolean;
  message: string;
  errors?: Array<string> | null;
};

/**
 * Loader interface for feature installation
 */
export type Loader = {
  name: string;
  description: string;
  run: (args: { config: Config }) => Promise<void>;
  uninstall: (args: { config: Config }) => Promise<void>;
  validate?: (args: { config: Config }) => Promise<ValidationResult>;
};

/**
 * Registry singleton for managing feature loaders
 */
export class LoaderRegistry {
  private static instance: LoaderRegistry | null = null;
  private loaders: Map<string, Loader>;

  private constructor() {
    this.loaders = new Map();

    // Register all loaders
    // IMPORTANT: profilesLoader must run FIRST to compose profiles before other loaders read from them
    this.loaders.set(profilesLoader.name, profilesLoader);
    this.loaders.set(skillsLoader.name, skillsLoader);
    this.loaders.set(claudeMdLoader.name, claudeMdLoader);
    this.loaders.set(hooksLoader.name, hooksLoader);
    this.loaders.set(slashCommandsLoader.name, slashCommandsLoader);
    this.loaders.set(statuslineLoader.name, statuslineLoader);
    this.loaders.set(subagentsLoader.name, subagentsLoader);
  }

  /**
   * Get the singleton instance
   * @returns The LoaderRegistry singleton instance
   */
  public static getInstance(): LoaderRegistry {
    if (LoaderRegistry.instance == null) {
      LoaderRegistry.instance = new LoaderRegistry();
    }
    return LoaderRegistry.instance;
  }

  /**
   * Get all registered loaders
   * @returns Array of all loaders
   */
  public getAll(): Array<Loader> {
    return Array.from(this.loaders.values());
  }

  /**
   * Get all registered loaders in reverse order (for uninstall)
   * During install, profiles must run first to create profile directories.
   * During uninstall, profiles must run last so other loaders can still
   * read from profile directories to know what files to remove.
   * @returns Array of all loaders in reverse order
   */
  public getAllReversed(): Array<Loader> {
    return Array.from(this.loaders.values()).reverse();
  }
}
