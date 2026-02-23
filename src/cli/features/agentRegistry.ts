/**
 * Agent registry for managing AI agent implementations
 * Singleton registry that maps agent names to implementations
 */

import * as path from "path";

import { claudeCodeAgent } from "@/cli/features/claude-code/agent.js";
import { cursorAgent } from "@/cli/features/cursor-agent/agent.js";

import type { Config } from "@/cli/config.js";
import type { ManifestDiff } from "@/cli/features/manifest.js";

/**
 * Canonical agent names used as UIDs in the registry.
 * Each Agent.name must match one of these values.
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
 * Agent interface that each agent implementation must satisfy
 */
export type Agent = {
  /** Unique identifier used as registry key, e.g., "claude-code" */
  name: AgentName;
  /** Human-readable name, e.g., "Claude Code" */
  displayName: string;
  /** Short description of supported skillset features for this agent */
  description: string;
  /** Get the agent's config directory under the install directory */
  getAgentDir: (args: { installDir: string }) => string;
  /** Get the agent's skills directory under the install directory */
  getSkillsDir: (args: { installDir: string }) => string;
  /** Get the root-level filenames this agent manages */
  getManagedFiles: () => ReadonlyArray<string>;
  /** Get the directory names this agent manages recursively */
  getManagedDirs: () => ReadonlyArray<string>;
  /** Get the LoaderRegistry for this agent */
  getLoaderRegistry: () => LoaderRegistry;
  /** Check if this agent is installed at the given directory */
  isInstalledAtDir: (args: { path: string }) => boolean;
  /** Mark a directory as having this agent installed */
  markInstall: (args: { path: string; skillsetName?: string | null }) => void;
  /** Switch to a skillset (validates and updates config) */
  switchSkillset: (args: {
    installDir: string;
    skillsetName: string;
  }) => Promise<void>;
  /** Detect local changes to installed files by comparing against the stored manifest */
  detectLocalChanges: (args: {
    installDir: string;
  }) => Promise<ManifestDiff | null>;
  /** Remove all Nori-managed files for this agent at the given directory */
  removeSkillset: (args: { installDir: string }) => Promise<void>;
  /** Install a skillset: run feature loaders, write manifest, and mark install */
  installSkillset: (args: { config: Config }) => Promise<void>;
  /** Get the agent's projects/sessions directory (home-relative) */
  getProjectsDir?: (() => string) | null;
  /** Find agent configuration artifacts starting from a directory */
  findArtifacts?:
    | ((args: {
        startDir: string;
        stopDir?: string | null;
      }) => Promise<Array<AgentArtifact>>)
    | null;
  /** Factory reset: remove all agent configuration from the filesystem */
  factoryReset?: ((args: { path: string }) => Promise<void>) | null;
  /** Detect pre-existing unmanaged configuration at the given directory */
  detectExistingConfig?:
    | ((args: { installDir: string }) => Promise<ExistingConfig | null>)
    | null;
  /** Capture existing config as a named skillset, clean up originals, and restore working state */
  captureExistingConfig?:
    | ((args: {
        installDir: string;
        skillsetName: string;
        config: Config;
      }) => Promise<void>)
    | null;
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
   * Get all registered agents
   * @returns Array of all agent implementations
   */
  public getAll(): Array<Agent> {
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
