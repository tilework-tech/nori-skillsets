/**
 * Loader registry for Cursor agent feature installation
 * Singleton registry that manages all feature loaders for Cursor
 */

import { configLoader } from "@/cli/features/config/loader.js";
import { cursorProfilesLoader } from "@/cli/features/cursor-agent/skillsets/loader.js";

import type { Loader } from "@/cli/features/agentRegistry.js";

/**
 * Registry singleton for managing Cursor feature loaders
 */
export class CursorLoaderRegistry {
  private static instance: CursorLoaderRegistry | null = null;
  private loaders: Map<string, Loader>;

  private constructor() {
    this.loaders = new Map();

    // Register all loaders
    // IMPORTANT: Order matters — config must run before profiles
    this.loaders.set(configLoader.name, configLoader);
    this.loaders.set(cursorProfilesLoader.name, cursorProfilesLoader);
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
   * Get all registered loaders
   * @returns Array of all loaders
   */
  public getAll(): Array<Loader> {
    return Array.from(this.loaders.values());
  }
}
