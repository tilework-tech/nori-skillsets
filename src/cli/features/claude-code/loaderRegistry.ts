/**
 * Loader registry for feature installation
 * Singleton registry that manages all feature loaders
 */

import { announcementsLoader } from "@/cli/features/claude-code/announcements/loader.js";
import { hooksLoader } from "@/cli/features/claude-code/hooks/loader.js";
import { profilesLoader } from "@/cli/features/claude-code/profiles/loader.js";
import { globalSlashCommandsLoader } from "@/cli/features/claude-code/slashcommands/loader.js";
import { statuslineLoader } from "@/cli/features/claude-code/statusline/loader.js";
import { configLoader } from "@/cli/features/config/loader.js";

import type { Loader } from "@/cli/features/agentRegistry.js";

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
    // - config must run before profiles (profiles may depend on config)
    // - configLoader also handles the version file lifecycle
    // - profilesLoader must run after config to compose profiles and install profile-dependent features
    // - During uninstall, the order is reversed automatically
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
