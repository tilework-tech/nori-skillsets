/**
 * Loader registry for feature installation
 * Singleton registry that manages all feature loaders
 */

import { announcementsLoader } from "@/cli/features/announcements/loader.js";
import { configLoader } from "@/cli/features/config/loader.js";
import { hooksLoader } from "@/cli/features/hooks/loader.js";
import { profilesLoader } from "@/cli/features/profiles/loader.js";
import { globalSlashCommandsLoader } from "@/cli/features/slashcommands/loader.js";
import { statuslineLoader } from "@/cli/features/statusline/loader.js";
import { versionLoader } from "@/cli/features/version/loader.js";

import type { Config } from "@/cli/config.js";

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
    // IMPORTANT: Order matters!
    // - version and config must run before profiles (profiles may depend on config)
    // - profilesLoader must run after version/config to compose profiles and install profile-dependent features
    // - During uninstall, the order is reversed automatically
    this.loaders.set(versionLoader.name, versionLoader);
    this.loaders.set(configLoader.name, configLoader);
    this.loaders.set(profilesLoader.name, profilesLoader);
    this.loaders.set(hooksLoader.name, hooksLoader);
    this.loaders.set(statuslineLoader.name, statuslineLoader);
    this.loaders.set(globalSlashCommandsLoader.name, globalSlashCommandsLoader);
    this.loaders.set(announcementsLoader.name, announcementsLoader);
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
