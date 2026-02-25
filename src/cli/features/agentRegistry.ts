/**
 * Agent registry for managing AI agent configurations
 * Singleton registry that maps agent names to pure data configurations
 */

import * as path from "path";

import { type Config } from "@/cli/config.js";
import { claudeCodeConfig } from "@/cli/features/claude-code/agent.js";
import { cursorConfig } from "@/cli/features/cursor-agent/agent.js";

/**
 * Canonical agent names used as UIDs in the registry.
 * Each AgentConfig.name must match one of these values.
 */
export type AgentName = "claude-code" | "cursor-agent";

/**
 * Loader interface for feature installation
 * Each loader handles installing a specific feature (config, profiles, hooks, etc.)
 */
export type Loader = {
  name: string;
  description: string;
  run: (args: { config: Config }) => Promise<string | void>;
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
 * Pure data configuration for an agent.
 * All behavior lives in shared handler functions that accept this as a parameter.
 */
export type AgentConfig = {
  /** Unique identifier used as registry key, e.g., "claude-code" */
  name: AgentName;
  /** Human-readable name, e.g., "Claude Code" */
  displayName: string;
  /** Short description of supported skillset features for this agent */
  description: string;

  /**
   * Relative path from installDir to the agent's config directory.
   * e.g. ".claude" or ".cursor"
   */
  agentDirName: string;

  /**
   * Relative path from the agent dir to the instruction file.
   * e.g. "CLAUDE.md" or "rules/AGENTS.md"
   */
  instructionFilePath: string;

  /**
   * The config file name used when parsing skillsets from ~/.nori/profiles/.
   * This is the SOURCE file name (e.g., "CLAUDE.md"), not the destination.
   */
  configFileName: string;

  /**
   * Relative path from the agent dir to the skills directory.
   * e.g. "skills"
   */
  skillsPath: string;

  /**
   * Relative path from the agent dir to the slashcommands directory.
   * e.g. "commands"
   */
  slashcommandsPath: string;

  /**
   * Relative path from the agent dir to the subagents directory.
   * e.g. "agents"
   */
  subagentsPath: string;

  /**
   * Extra loaders specific to this agent (hooks, statusline, announcements).
   * These run after the shared profile loaders during installSkillset.
   */
  extraLoaders?: ReadonlyArray<Loader> | null;

  /**
   * Additional root-level filenames this agent manages beyond the instruction file.
   * e.g. ["settings.json", "nori-statusline.sh"] for claude-code.
   * The instruction file basename is always included automatically.
   */
  extraManagedFiles?: ReadonlyArray<string> | null;

  /**
   * Additional managed directories beyond skills/commands/agents.
   * e.g. ["rules"] for cursor-agent (because AGENTS.md lives in .cursor/rules/).
   */
  extraManagedDirs?: ReadonlyArray<string> | null;

  /**
   * Absolute path where this agent stores session transcripts.
   * Used by the watch command. null if the agent doesn't support transcripts.
   */
  transcriptDirectory?: string | null;

  /**
   * Optional function for backwards-compatible installation detection.
   * For Claude Code, checks if CLAUDE.md contains "NORI-AI MANAGED BLOCK".
   * Returns true if the agent is detected as installed via legacy means.
   */
  legacyMarkerDetection?: ((args: { agentDir: string }) => boolean) | null;

  /**
   * Whether this agent has a legacy manifest path to clean up.
   * Only claude-code has this (getLegacyManifestPath).
   */
  hasLegacyManifest?: boolean | null;

  /**
   * Optional function to configure agent-specific permissions after profile installation.
   * For Claude Code, adds skills dir and profiles dir to settings.json additionalDirectories.
   */
  configurePermissions?:
    | ((args: { config: Config; installDir: string }) => Promise<void>)
    | null;

  /**
   * Optional function to find agent-specific artifacts in ancestor directories.
   * Used by factory reset to discover what to delete.
   */
  findArtifacts?:
    | ((args: {
        startDir: string;
        stopDir?: string | null;
      }) => Promise<Array<AgentArtifact>>)
    | null;

  /**
   * Optional function to perform agent-specific factory reset.
   * If null, the shared handler will walk the ancestor tree.
   */
  factoryReset?: ((args: { path: string }) => Promise<void>) | null;
};

/**
 * Registry singleton for managing agent configurations
 */
export class AgentRegistry {
  private static instance: AgentRegistry | null = null;
  private agents: Map<string, AgentConfig>;

  private constructor() {
    this.agents = new Map();
    this.agents.set(claudeCodeConfig.name, claudeCodeConfig);
    this.agents.set(cursorConfig.name, cursorConfig);
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
   * Get an agent config by name
   * @param args - Configuration arguments
   * @param args.name - The agent name to look up (validated at runtime)
   *
   * @throws Error if agent not found
   *
   * @returns The agent configuration
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
   * Get all registered agent configs
   * @returns Array of all agent configurations
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
   * @returns Array of agent directory basenames (e.g., [".claude", ".cursor"])
   */
  public getAgentDirNames(): Array<string> {
    return this.getAll().map((agent) => path.basename(agent.agentDirName));
  }
}
