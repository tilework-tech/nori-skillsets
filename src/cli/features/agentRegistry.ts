/**
 * Agent registry for managing AI agent implementations
 * Singleton registry that maps agent names to implementations
 */

import * as path from "path";

import { claudeCodeAgentConfig } from "@/cli/features/claude-code/agent.js";
import { cursorAgentConfig } from "@/cli/features/cursor-agent/agent.js";

import type { Config } from "@/cli/config.js";
import type { Skillset } from "@/norijson/skillset.js";

/**
 * Canonical agent names used as UIDs in the registry.
 * Each AgentConfig.name must match one of these values.
 */
export type AgentName = "claude-code" | "cursor-agent";

/**
 * Unified loader interface for AgentConfig
 * Each loader handles installing a specific feature.
 * Receives agent config and optional skillset for path resolution.
 * Declares which files/dirs it manages for manifest tracking.
 */
export type AgentLoader = {
  name: string;
  description: string;
  managedFiles?: ReadonlyArray<string> | null;
  managedDirs?: ReadonlyArray<string> | null;
  run: (args: {
    agent: AgentConfig;
    config: Config;
    skillset?: Skillset | null;
  }) => Promise<string | void>;
};

/**
 * Represents a discovered configuration artifact for an agent.
 * Used by factory reset to show what will be deleted.
 */
export type AgentArtifact = {
  path: string;
  type: "directory" | "file";
};

/**
 * Represents detected existing (unmanaged) configuration for an agent.
 * Used during init to show the user what was found before capturing.
 */
export type ExistingConfig = {
  configFileName: string;
  hasConfigFile: boolean;
  hasManagedBlock: boolean;
  hasSkills: boolean;
  skillCount: number;
  hasAgents: boolean;
  agentCount: number;
  hasCommands: boolean;
  commandCount: number;
};

/**
 * Data-oriented agent configuration
 * Replaces the monolithic Agent type with a minimal config object.
 * All operations are shared functions in agentOperations.ts.
 */
export type AgentConfig = {
  name: AgentName;
  displayName: string;
  description: string;

  getAgentDir: (args: { installDir: string }) => string;
  getSkillsDir: (args: { installDir: string }) => string;
  getSubagentsDir: (args: { installDir: string }) => string;
  getSlashcommandsDir: (args: { installDir: string }) => string;
  getInstructionsFilePath: (args: { installDir: string }) => string;

  getLoaders: () => Array<AgentLoader>;

  getTranscriptDirectory?: (() => string) | null;
  getArtifactPatterns?:
    | (() => {
        dirs: ReadonlyArray<string>;
        files: ReadonlyArray<string>;
      })
    | null;
};

/**
 * Registry singleton for managing agent implementations
 */
export class AgentRegistry {
  private static instance: AgentRegistry | null = null;
  private agents: Map<string, AgentConfig>;

  private constructor() {
    this.agents = new Map();
    this.agents.set(claudeCodeAgentConfig.name, claudeCodeAgentConfig);
    this.agents.set(cursorAgentConfig.name, cursorAgentConfig);
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
  public get(args: { name: string }): AgentConfig {
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
   * Get all registered agents
   * @returns Array of all agent implementations
   */
  public getAll(): Array<AgentConfig> {
    return Array.from(this.agents.values());
  }

  /**
   * List all registered agent names
   * @returns Array of valid agent names
   */
  public list(): Array<AgentName> {
    return Array.from(this.agents.keys()) as Array<AgentName>;
  }

  /**
   * Get the default agent name (first registered agent)
   * Used as a fallback when no agent is explicitly specified.
   * @returns The default agent name
   */
  public getDefaultAgentName(): AgentName {
    return this.list()[0];
  }

  /**
   * Get the basenames of all agent config directories.
   * Used by normalizeInstallDir to strip known agent dir suffixes from paths.
   * @returns Array of agent directory basenames (e.g., [".claude"])
   */
  public getAgentDirNames(): Array<string> {
    return this.getAll().map((agent) => {
      const agentDir = agent.getAgentDir({ installDir: "/" });
      return path.basename(agentDir);
    });
  }
}
