/**
 * Agent registry for managing AI agent implementations
 * Singleton registry that maps agent names to implementations
 */

import { claudeCodeAgent } from "@/cli/features/claude-code/agent.js";

import type { Config } from "@/cli/config.js";

/**
 * Canonical agent names used as UIDs in the registry.
 * Each Agent.name must match one of these values.
 */
export type AgentName = "claude-code" | "codex";

/**
 * Lightweight agent definition for use outside the full Agent interface
 */
export type AgentDefinition = {
  name: AgentName;
  displayName: string;
};

/**
 * Loader interface for feature installation
 * Each loader handles installing a specific feature (config, profiles, hooks, etc.)
 */
export type Loader = {
  name: string;
  description: string;
  run: (args: { config: Config }) => Promise<void>;
};

/**
 * LoaderRegistry interface that agent-specific registries must implement.
 * Each agent maintains its own singleton registry class that implements this interface.
 *
 * IMPORTANT: All agents MUST include the config loader in their registry.
 * The config loader (from @/cli/features/config/loader.js) manages the shared
 * .nori-config.json file and must be included for proper installation.
 */
export type LoaderRegistry = {
  /** Get all registered loaders in installation order */
  getAll: () => Array<Loader>;
};

/**
 * Agent interface that each agent implementation must satisfy
 */
export type Agent = {
  /** Unique identifier used as registry key, e.g., "claude-code" */
  name: AgentName;
  /** Human-readable name, e.g., "Claude Code" */
  displayName: string;
  /** Get the LoaderRegistry for this agent */
  getLoaderRegistry: () => LoaderRegistry;
  /** Switch to a profile (validates and updates config) */
  switchProfile: (args: {
    installDir: string;
    profileName: string;
  }) => Promise<void>;
  /** Factory reset: remove all agent configuration from the filesystem */
  factoryReset?: ((args: { path: string }) => Promise<void>) | null;
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
   * @param args.name - The agent name to look up (validated at runtime)
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
   * @returns Array of valid agent names
   */
  public list(): Array<AgentName> {
    return Array.from(this.agents.keys()) as Array<AgentName>;
  }
}
