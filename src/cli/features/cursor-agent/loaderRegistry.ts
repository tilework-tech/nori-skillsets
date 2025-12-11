/**
 * Loader registry for cursor-agent feature installation
 * Singleton registry that manages all cursor-agent feature loaders
 */

import { configLoader } from "@/cli/features/config/loader.js";
import { hooksLoader } from "@/cli/features/cursor-agent/hooks/loader.js";
import { profilesLoader } from "@/cli/features/cursor-agent/profiles/loader.js";
import { cursorSlashCommandsLoader } from "@/cli/features/cursor-agent/slashcommands/loader.js";

import type { Loader } from "@/cli/features/agentRegistry.js";

/**
 * Registry singleton for managing cursor-agent feature loaders
 */
export class CursorLoaderRegistry {
  private static instance: CursorLoaderRegistry | null = null;
  private loaders: Map<string, Loader>;

  private constructor() {
    this.loaders = new Map();

    // Register all loaders
    // IMPORTANT: config loader must be included - it manages the shared .nori-config.json
    this.loaders.set(configLoader.name, configLoader);
    this.loaders.set(profilesLoader.name, profilesLoader);
    this.loaders.set(hooksLoader.name, hooksLoader);
    this.loaders.set(cursorSlashCommandsLoader.name, cursorSlashCommandsLoader);
  }

  /**
   * Get the singleton instance
   * @returns The CursorLoaderRegistry singleton instance
   */
  public static getInstance(): CursorLoaderRegistry {
    if (CursorLoaderRegistry.instance == null) {
      CursorLoaderRegistry.instance = new CursorLoaderRegistry();
    }
    return CursorLoaderRegistry.instance;
  }

  /**
   * Reset the singleton instance (for testing)
   */
  public static resetInstance(): void {
    CursorLoaderRegistry.instance = null;
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
   * @returns Array of all loaders in reverse order
   */
  public getAllReversed(): Array<Loader> {
    return Array.from(this.loaders.values()).reverse();
  }
}
