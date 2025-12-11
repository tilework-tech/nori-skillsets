/**
 * Loader registry for cursor-agent feature installation
 * Singleton registry that manages all cursor-agent feature loaders
 */

import { profilesLoader } from "@/cli/features/cursor-agent/profiles/loader.js";
import { cursorSlashCommandsLoader } from "@/cli/features/cursor-agent/slashcommands/loader.js";

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
export type CursorLoader = {
  name: string;
  description: string;
  run: (args: { config: Config }) => Promise<void>;
  uninstall: (args: { config: Config }) => Promise<void>;
  validate?: (args: { config: Config }) => Promise<ValidationResult>;
};

/**
 * Registry singleton for managing cursor-agent feature loaders
 */
export class CursorLoaderRegistry {
  private static instance: CursorLoaderRegistry | null = null;
  private loaders: Map<string, CursorLoader>;

  private constructor() {
    this.loaders = new Map();

    // Register all loaders
    this.loaders.set(profilesLoader.name, profilesLoader);
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
  public getAll(): Array<CursorLoader> {
    return Array.from(this.loaders.values());
  }

  /**
   * Get all registered loaders in reverse order (for uninstall)
   * @returns Array of all loaders in reverse order
   */
  public getAllReversed(): Array<CursorLoader> {
    return Array.from(this.loaders.values()).reverse();
  }
}
