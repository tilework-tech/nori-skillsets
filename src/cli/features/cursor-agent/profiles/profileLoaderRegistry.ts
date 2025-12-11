/**
 * Profile loader registry for cursor-agent profile-dependent feature installation
 * Singleton registry that manages loaders for features that depend on profile composition
 */

import { agentsMdLoader } from "@/cli/features/cursor-agent/profiles/agentsmd/loader.js";
import { rulesLoader } from "@/cli/features/cursor-agent/profiles/rules/loader.js";

import type { Config } from "@/cli/config.js";
import type { ValidationResult } from "@/cli/features/agentRegistry.js";

/**
 * Profile loader interface for profile-dependent feature installation
 * Uses 'install' instead of 'run' to distinguish from main loaders
 */
export type CursorProfileLoader = {
  name: string;
  description: string;
  install: (args: { config: Config }) => Promise<void>;
  uninstall: (args: { config: Config }) => Promise<void>;
  validate?: (args: { config: Config }) => Promise<ValidationResult>;
};

/**
 * Registry singleton for managing cursor profile loaders
 */
export class CursorProfileLoaderRegistry {
  private static instance: CursorProfileLoaderRegistry | null = null;
  private loaders: Map<string, CursorProfileLoader>;

  private constructor() {
    this.loaders = new Map();

    // Register all profile loaders
    // Order matters: rules must be installed before agentsmd
    this.loaders.set(rulesLoader.name, rulesLoader);
    this.loaders.set(agentsMdLoader.name, agentsMdLoader);
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
   * Reset the singleton instance (for testing)
   */
  public static resetInstance(): void {
    CursorProfileLoaderRegistry.instance = null;
  }

  /**
   * Get all registered profile loaders
   * @returns Array of all profile loaders
   */
  public getAll(): Array<CursorProfileLoader> {
    return Array.from(this.loaders.values());
  }

  /**
   * Get all registered profile loaders in reverse order (for uninstall)
   * @returns Array of all profile loaders in reverse order
   */
  public getAllReversed(): Array<CursorProfileLoader> {
    return Array.from(this.loaders.values()).reverse();
  }
}
