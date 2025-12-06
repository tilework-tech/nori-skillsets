/**
 * Agent Registry for multi-agent support
 *
 * Maps agent names (e.g., "claude-code") to their loader registries
 * and provides agent-specific configuration like source profiles directories.
 */

import * as path from "path";
import { fileURLToPath } from "url";

import { LoaderRegistry } from "@/cli/agents/claude/loaderRegistry.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Configuration for a supported coding agent
 */
export type AgentConfig = {
  name: string;
  description: string;
  getLoaderRegistry: () => LoaderRegistry;
  getSourceProfilesDir: () => string;
};

/**
 * Registry for managing supported coding agents
 * Each agent has its own loader registry and configuration
 */
export class AgentRegistry {
  private static instance: AgentRegistry | null = null;
  private agents: Map<string, AgentConfig>;
  private defaultAgentName: string;

  private constructor() {
    this.agents = new Map();
    this.defaultAgentName = "claude-code";

    // Register Claude Code agent
    this.agents.set("claude-code", {
      name: "claude-code",
      description: "Claude Code - Anthropic's AI coding assistant",
      getLoaderRegistry: () => LoaderRegistry.getInstance(),
      getSourceProfilesDir: () =>
        path.join(__dirname, "claude", "profiles", "config"),
    });
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
   * Get an agent by name
   * @param args - Configuration arguments
   * @param args.name - The agent name to look up
   *
   * @throws Error if agent is not found
   *
   * @returns The agent configuration
   */
  public getAgent(args: { name: string }): AgentConfig {
    const { name } = args;
    const agent = this.agents.get(name);

    if (agent == null) {
      const validAgents = Array.from(this.agents.keys()).join(", ");
      throw new Error(
        `Unknown agent "${name}". Valid agents are: ${validAgents}`,
      );
    }

    return agent;
  }

  /**
   * Get all registered agents
   * @returns Array of all agent configurations
   */
  public getAllAgents(): Array<AgentConfig> {
    return Array.from(this.agents.values());
  }

  /**
   * Get the default agent
   * @returns The default agent configuration
   */
  public getDefaultAgent(): AgentConfig {
    return this.getAgent({ name: this.defaultAgentName });
  }

  /**
   * Get the default agent name
   * @returns The default agent name
   */
  public getDefaultAgentName(): string {
    return this.defaultAgentName;
  }
}
