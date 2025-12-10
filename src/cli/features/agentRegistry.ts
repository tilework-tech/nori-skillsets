/**
 * Agent registry for managing AI agent implementations
 * Singleton registry that maps agent names to implementations
 */

import { claudeCodeAgent } from "@/cli/features/claude-code/agent.js";

import type { LoaderRegistry } from "@/cli/features/claude-code/loaderRegistry.js";

/**
 * Environment paths exposed by agents for CLI use
 * Only includes paths actually needed by CLI commands
 */
export type AgentEnvPaths = {
  /** Profiles directory */
  profilesDir: string;
  /** Instructions file name, e.g., "CLAUDE.md" or "AGENTS.md" */
  instructionsFile: string;
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
  getLoaderRegistry: () => LoaderRegistry;
  /** Get environment paths for this agent */
  getEnvPaths: (args: { installDir: string }) => AgentEnvPaths;
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
