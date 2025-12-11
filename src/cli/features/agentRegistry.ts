/**
 * Agent registry for managing AI agent implementations
 * Singleton registry that maps agent names to implementations
 */

import { claudeCodeAgent } from "@/cli/features/claude-code/agent.js";
import { cursorAgent } from "@/cli/features/cursor-agent/agent.js";

import type { LoaderRegistry } from "@/cli/features/claude-code/loaderRegistry.js";
import type { CursorLoaderRegistry } from "@/cli/features/cursor-agent/loaderRegistry.js";

/**
 * Profile metadata returned by listSourceProfiles
 */
export type SourceProfile = {
  name: string;
  description: string;
};

/**
 * Agent interface that each agent implementation must satisfy
 */
export type Agent = {
  /** Unique identifier, e.g., "claude-code" */
  name: string;
  /** Human-readable name, e.g., "Claude Code" */
  displayName: string;
  /** Get the LoaderRegistry for this agent */
  getLoaderRegistry: () => LoaderRegistry | CursorLoaderRegistry;
  /** List installed profiles for this agent (from ~/.{agent}/profiles/) */
  listProfiles: (args: { installDir: string }) => Promise<Array<string>>;
  /** List profiles from package source directory (for install UI) */
  listSourceProfiles: () => Promise<Array<SourceProfile>>;
  /** Switch to a profile (validates and updates config) */
  switchProfile: (args: {
    installDir: string;
    profileName: string;
  }) => Promise<void>;
};

/**
 * Registry singleton for managing agent implementations
 */
export class AgentRegistry {
  private static instance: AgentRegistry | null = null;
  private agents: Map<string, Agent>;

  private constructor() {
    this.agents = new Map();
    this.agents.set(claudeCodeAgent.name, claudeCodeAgent);
    this.agents.set(cursorAgent.name, cursorAgent);
  }

  /**
   * Get the singleton instance
   * @returns The AgentRegistry singleton instance
   */
  public static getInstance(): AgentRegistry {
    if (AgentRegistry.instance == null) {
      AgentRegistry.instance = new AgentRegistry();
    }
    return AgentRegistry.instance;
  }

  /**
   * Reset the singleton instance (for testing)
   */
  public static resetInstance(): void {
    AgentRegistry.instance = null;
  }

  /**
   * Get an agent by name
   * @param args - Configuration arguments
   * @param args.name - The agent name to look up
   *
   * @throws Error if agent not found
   *
   * @returns The agent implementation
   */
  public get(args: { name: string }): Agent {
    const { name } = args;
    const agent = this.agents.get(name);

    if (agent == null) {
      const available = this.list().join(", ");
      throw new Error(
        `Unknown agent '${name}'. Available agents: ${available}`,
      );
    }

    return agent;
  }

  /**
   * List all registered agent names
   * @returns Array of agent names
   */
  public list(): Array<string> {
    return Array.from(this.agents.keys());
  }
}
