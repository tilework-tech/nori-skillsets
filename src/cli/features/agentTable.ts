/**
 * The single declarative definition of every agent nori-skillsets supports.
 *
 * Each agent is one AgentDefinition row: paths, formats, capabilities, and
 * support tier. buildAgentConfig turns a row into the AgentConfig consumed by
 * the registry and shared operations. Adding an agent means adding a row —
 * agent-specific code is only ever referenced from the row itself (e.g. the
 * claude-code hooks/statusline/announcements loaders).
 */

import * as path from "path";

import { announcementsLoader } from "@/cli/features/claude-code/announcements/loader.js";
import { hooksLoader } from "@/cli/features/claude-code/hooks/loader.js";
import { getClaudeHomeSettingsFile } from "@/cli/features/claude-code/paths.js";
import { statuslineLoader } from "@/cli/features/claude-code/statusline/loader.js";
import { configLoader } from "@/cli/features/configLoader.js";
import { createInstructionsLoader } from "@/cli/features/shared/instructionsLoader.js";
import { createMcpLoader } from "@/cli/features/shared/mcpLoader.js";
import { skillsLoader } from "@/cli/features/shared/skillsLoader.js";
import { createSlashCommandsLoader } from "@/cli/features/shared/slashCommandsLoader.js";
import { createSubagentsLoader } from "@/cli/features/shared/subagentsLoader.js";
import { getHomeDir } from "@/utils/home.js";

import type {
  AgentCapabilities,
  AgentConfig,
  AgentLoader,
  AgentName,
  AgentSupportTier,
} from "@/cli/features/agentRegistry.js";
import type { SubagentTargetFormat } from "@/cli/features/shared/subagentEmitter.js";

/**
 * Where the managed instructions file lives:
 * - "agent-dir": inside the agent config dir (default)
 * - "rules-subdir": inside a rules/ subdir of the agent config dir
 * - "install-root-for-project": at the install root for project installs,
 *   inside the agent config dir for global (home) installs
 */
type InstructionsPlacement =
  | "agent-dir"
  | "rules-subdir"
  | "install-root-for-project";

type McpBinding = Parameters<typeof createMcpLoader>[0];

export type AgentDefinition = {
  name: AgentName;
  displayName: string;
  supportTier: AgentSupportTier;
  /** Agent config dir as path segments under the install dir */
  agentDirSegments: ReadonlyArray<string>;
  /** Overrides agentDirSegments when the install dir is the home dir */
  globalAgentDirSegments?: ReadonlyArray<string> | null;
  subagentsDirName: string;
  slashcommandsDirName: string;
  instructionsFileName: string;
  instructionsPlacement?: InstructionsPlacement | null;
  subagentTargetFormat?: SubagentTargetFormat | null;
  mcp?: McpBinding | null;
  /** Agent-specific loaders appended after the shared set */
  extraLoaders?: ReadonlyArray<AgentLoader> | null;
  externalSettingsFiles?: (() => ReadonlyArray<string>) | null;
  transcriptDirectory?: (() => string) | null;
  artifactPatterns?: {
    dirs: ReadonlyArray<string>;
    files: ReadonlyArray<string>;
  } | null;
};

export const DEFAULT_AGENT_NAME: AgentName = "claude-code";

export const AGENT_DEFINITIONS: ReadonlyArray<AgentDefinition> = [
  {
    name: "claude-code",
    displayName: "Claude Code",
    supportTier: "supported",
    agentDirSegments: [".claude"],
    subagentsDirName: "agents",
    slashcommandsDirName: "commands",
    instructionsFileName: "CLAUDE.md",
    mcp: {
      format: "claude-mcp-json",
      projectFile: ({ installDir }) => path.join(installDir, ".mcp.json"),
      projectMergeStrategy: "whole-file",
      userFile: () => path.join(getHomeDir(), ".claude.json"),
      userMergeStrategy: "merge-mcp-servers-key",
    },
    extraLoaders: [hooksLoader, statuslineLoader, announcementsLoader],
    externalSettingsFiles: () => [getClaudeHomeSettingsFile()],
    transcriptDirectory: () => path.join(getHomeDir(), ".claude", "projects"),
    artifactPatterns: { dirs: [".claude"], files: ["CLAUDE.md"] },
  },
  {
    name: "cline",
    displayName: "Cline",
    supportTier: "experimental",
    agentDirSegments: [".cline"],
    subagentsDirName: "agents",
    slashcommandsDirName: "commands",
    instructionsFileName: "AGENTS.md",
    instructionsPlacement: "rules-subdir",
  },
  {
    // Codex CLI reads custom prompts from ~/.codex/prompts/ (global only —
    // project scope is "not planned" per github.com/openai/codex#9848). For
    // project installs, the prompts directory below still uses `prompts/`
    // for cosmetic accuracy, but codex won't read them.
    name: "codex",
    displayName: "Codex",
    supportTier: "supported",
    agentDirSegments: [".codex"],
    subagentsDirName: "agents",
    slashcommandsDirName: "prompts",
    instructionsFileName: "AGENTS.md",
    instructionsPlacement: "install-root-for-project",
    subagentTargetFormat: "codex-toml",
    mcp: {
      format: "codex-toml",
      projectFile: ({ installDir }) =>
        path.join(installDir, ".codex", "config.toml"),
      projectMergeStrategy: "merge-toml-table",
      userFile: () => path.join(getHomeDir(), ".codex", "config.toml"),
      userMergeStrategy: "merge-toml-table",
    },
  },
  {
    name: "cursor-agent",
    displayName: "Cursor",
    supportTier: "supported",
    agentDirSegments: [".cursor"],
    subagentsDirName: "agents",
    slashcommandsDirName: "commands",
    instructionsFileName: "AGENTS.md",
    instructionsPlacement: "rules-subdir",
    mcp: {
      format: "cursor-json",
      projectFile: ({ installDir }) =>
        path.join(installDir, ".cursor", "mcp.json"),
      projectMergeStrategy: "merge-mcp-servers-key",
      userFile: () => path.join(getHomeDir(), ".cursor", "mcp.json"),
      userMergeStrategy: "merge-mcp-servers-key",
    },
  },
  {
    name: "droid",
    displayName: "Droid",
    supportTier: "experimental",
    agentDirSegments: [".factory"],
    subagentsDirName: "droids",
    slashcommandsDirName: "commands",
    instructionsFileName: "AGENTS.md",
  },
  {
    name: "gemini-cli",
    displayName: "Gemini CLI",
    supportTier: "supported",
    agentDirSegments: [".gemini"],
    subagentsDirName: "agents",
    slashcommandsDirName: "commands",
    instructionsFileName: "GEMINI.md",
    mcp: {
      format: "gemini-json",
      projectFile: ({ installDir }) =>
        path.join(installDir, ".gemini", "settings.json"),
      projectMergeStrategy: "merge-mcp-servers-key",
      userFile: () => path.join(getHomeDir(), ".gemini", "settings.json"),
      userMergeStrategy: "merge-mcp-servers-key",
    },
  },
  {
    name: "github-copilot",
    displayName: "GitHub Copilot",
    supportTier: "supported",
    agentDirSegments: [".github"],
    subagentsDirName: "agents",
    slashcommandsDirName: "prompts",
    instructionsFileName: "copilot-instructions.md",
  },
  {
    // Goose's canonical global config dir is ~/.config/goose/. It has no
    // project-level config dir; project-level instructions live as AGENTS.md
    // (or .goosehints) at the project root.
    name: "goose",
    displayName: "Goose",
    supportTier: "supported",
    agentDirSegments: [".goose"],
    globalAgentDirSegments: [".config", "goose"],
    subagentsDirName: "agents",
    slashcommandsDirName: "commands",
    instructionsFileName: "AGENTS.md",
    instructionsPlacement: "install-root-for-project",
  },
  {
    name: "kilo",
    displayName: "Kilo Code",
    supportTier: "experimental",
    agentDirSegments: [".kilocode"],
    subagentsDirName: "agents",
    slashcommandsDirName: "commands",
    instructionsFileName: "AGENTS.md",
    instructionsPlacement: "rules-subdir",
  },
  {
    name: "kimi-cli",
    displayName: "Kimi CLI",
    supportTier: "experimental",
    agentDirSegments: [".kimi"],
    subagentsDirName: "agents",
    slashcommandsDirName: "commands",
    instructionsFileName: "AGENTS.md",
  },
  {
    name: "opencode",
    displayName: "OpenCode",
    supportTier: "experimental",
    agentDirSegments: [".opencode"],
    subagentsDirName: "agents",
    slashcommandsDirName: "commands",
    instructionsFileName: "AGENTS.md",
    instructionsPlacement: "install-root-for-project",
  },
  {
    name: "openclaw",
    displayName: "OpenClaw",
    supportTier: "experimental",
    agentDirSegments: [".openclaw"],
    subagentsDirName: "agents",
    slashcommandsDirName: "commands",
    instructionsFileName: "AGENTS.md",
  },
  {
    name: "pi",
    displayName: "Pi",
    supportTier: "supported",
    agentDirSegments: [".pi", "agent"],
    subagentsDirName: "subagents",
    slashcommandsDirName: "prompts",
    instructionsFileName: "AGENTS.md",
    subagentTargetFormat: "pi-markdown",
  },
];

const isGlobalInstall = (args: { installDir: string }): boolean => {
  const { installDir } = args;
  return path.resolve(installDir) === path.resolve(getHomeDir());
};

const deriveCapabilities = (args: {
  definition: AgentDefinition;
}): AgentCapabilities => {
  const { definition } = args;
  const extraNames = (definition.extraLoaders ?? []).map((l) => l.name);
  return {
    mcp: definition.mcp != null,
    hooks: extraNames.includes("hooks"),
    statusline: extraNames.includes("statusline"),
    transcripts: definition.transcriptDirectory != null,
  };
};

const deriveDescription = (args: {
  capabilities: AgentCapabilities;
}): string => {
  const { capabilities } = args;
  const parts = ["Instructions", "skills", "subagents", "commands"];
  if (capabilities.mcp) {
    parts.push("MCP");
  }
  if (capabilities.hooks) {
    parts.push("hooks");
  }
  if (capabilities.statusline) {
    parts.push("statusline");
  }
  if (capabilities.transcripts) {
    parts.push("watch");
  }
  return parts.join(", ");
};

export const buildAgentConfig = (args: {
  definition: AgentDefinition;
}): AgentConfig => {
  const { definition } = args;

  const dirSegments = (dirArgs: {
    installDir: string;
  }): ReadonlyArray<string> =>
    definition.globalAgentDirSegments != null && isGlobalInstall(dirArgs)
      ? definition.globalAgentDirSegments
      : definition.agentDirSegments;

  const getAgentDir = ({ installDir }: { installDir: string }): string =>
    path.join(installDir, ...dirSegments({ installDir }));

  const placement = definition.instructionsPlacement ?? "agent-dir";

  const getInstructionsFilePath = ({
    installDir,
  }: {
    installDir: string;
  }): string => {
    if (placement === "rules-subdir") {
      return path.join(
        getAgentDir({ installDir }),
        "rules",
        definition.instructionsFileName,
      );
    }
    if (
      placement === "install-root-for-project" &&
      !isGlobalInstall({ installDir })
    ) {
      return path.join(installDir, definition.instructionsFileName);
    }
    return path.join(
      getAgentDir({ installDir }),
      definition.instructionsFileName,
    );
  };

  const capabilities = deriveCapabilities({ definition });

  return {
    name: definition.name,
    displayName: definition.displayName,
    description: deriveDescription({ capabilities }),
    supportTier: definition.supportTier,
    capabilities,

    getAgentDir,
    getSkillsDir: ({ installDir }) =>
      path.join(getAgentDir({ installDir }), "skills"),
    getSubagentsDir: ({ installDir }) =>
      path.join(getAgentDir({ installDir }), definition.subagentsDirName),
    getSlashcommandsDir: ({ installDir }) =>
      path.join(getAgentDir({ installDir }), definition.slashcommandsDirName),
    getInstructionsFilePath,

    getLoaders: () => [
      configLoader,
      skillsLoader,
      createInstructionsLoader(
        placement === "rules-subdir"
          ? { managedDirs: ["rules"] }
          : { managedFiles: [definition.instructionsFileName] },
      ),
      createSlashCommandsLoader({
        managedDirs: [definition.slashcommandsDirName],
      }),
      createSubagentsLoader({
        managedDirs: [definition.subagentsDirName],
        ...(definition.subagentTargetFormat != null
          ? { targetFormat: definition.subagentTargetFormat }
          : {}),
      }),
      ...(definition.mcp != null ? [createMcpLoader(definition.mcp)] : []),
      ...(definition.extraLoaders ?? []),
    ],

    ...(definition.externalSettingsFiles != null
      ? { getExternalSettingsFiles: definition.externalSettingsFiles }
      : {}),
    ...(definition.transcriptDirectory != null
      ? { getTranscriptDirectory: definition.transcriptDirectory }
      : {}),
    ...(definition.artifactPatterns != null
      ? {
          getArtifactPatterns: () => ({
            dirs: [...(definition.artifactPatterns?.dirs ?? [])],
            files: [...(definition.artifactPatterns?.files ?? [])],
          }),
        }
      : {}),
  };
};
