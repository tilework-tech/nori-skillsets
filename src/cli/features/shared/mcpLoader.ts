/**
 * Shared MCP server config loader.
 *
 * Reads canonical MCP server JSON files from a skillset's mcp/ directory,
 * filters them by the active agent's worksWith list, and writes the
 * agent-specific format(s) to the appropriate location(s) — project scope
 * (in installDir) or user scope (in homedir).
 *
 * Each agent's binding (output paths + merge strategies) is supplied by
 * the agent's getLoaders() so format-specific quirks (Codex Option B,
 * settings.json merging, etc.) live with the agent definition.
 */

import * as fs from "fs/promises";
import * as path from "path";

import {
  emitMcpServers,
  type CanonicalMcpServer,
  type McpTargetFormat,
} from "@/cli/features/shared/mcpEmitter.js";

import type { AgentLoader } from "@/cli/features/agentRegistry.js";

export type McpMergeStrategy =
  | "whole-file"
  | "merge-mcp-servers-key"
  | "merge-toml-table";

const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
};

const readMcpDir = async (args: {
  mcpDir: string;
}): Promise<Array<CanonicalMcpServer>> => {
  const { mcpDir } = args;
  const result: Array<CanonicalMcpServer> = [];
  let entries: Array<string>;
  try {
    entries = await fs.readdir(mcpDir);
  } catch {
    return result;
  }

  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const filePath = path.join(mcpDir, entry);
    const content = await fs.readFile(filePath, "utf-8");
    try {
      const parsed = JSON.parse(content) as CanonicalMcpServer;
      if (parsed.name == null) {
        parsed.name = path.basename(entry, ".json");
      }
      result.push(parsed);
    } catch {
      // Skip malformed files
    }
  }

  return result;
};

const filterByAgent = (args: {
  servers: ReadonlyArray<CanonicalMcpServer>;
  agentName: string;
}): Array<CanonicalMcpServer> => {
  const { servers, agentName } = args;
  return servers.filter((s) => {
    if (s.worksWith == null || s.worksWith.length === 0) {
      return true;
    }
    return s.worksWith.includes(agentName);
  });
};

const splitByScope = (args: {
  servers: ReadonlyArray<CanonicalMcpServer>;
}): {
  project: Array<CanonicalMcpServer>;
  user: Array<CanonicalMcpServer>;
} => {
  const { servers } = args;
  const project: Array<CanonicalMcpServer> = [];
  const user: Array<CanonicalMcpServer> = [];
  for (const s of servers) {
    const scope = s.scope ?? "project";
    if (scope === "user") {
      user.push(s);
    } else {
      project.push(s);
    }
  }
  return { project, user };
};

const mergeMcpServersIntoJson = async (args: {
  filePath: string;
  rootKey: string;
  newServers: Record<string, unknown>;
}): Promise<void> => {
  const { filePath, rootKey, newServers } = args;
  let parsed: Record<string, unknown> = {};
  if (await fileExists(filePath)) {
    const existing = await fs.readFile(filePath, "utf-8");
    try {
      parsed = JSON.parse(existing) as Record<string, unknown>;
    } catch {
      parsed = {};
    }
  }
  const existingServers = (parsed[rootKey] as Record<string, unknown>) ?? {};
  parsed[rootKey] = { ...existingServers, ...newServers };

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(parsed, null, 2)}\n`);
};

const stripExistingMcpTables = (args: {
  content: string;
  serverNames: ReadonlyArray<string>;
}): string => {
  const { content, serverNames } = args;
  if (serverNames.length === 0) return content;

  let result = content;
  for (const name of serverNames) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Remove the server's main table and its .env sub-table.
    const blockRegex = new RegExp(
      `(^|\\n)\\[mcp_servers\\.${escaped}(?:\\.env)?\\][\\s\\S]*?(?=\\n\\[|$)`,
      "g",
    );
    result = result.replace(blockRegex, "");
  }
  // Normalize trailing whitespace.
  return result.replace(/\n{3,}/g, "\n\n").trimEnd();
};

const mergeTomlTables = async (args: {
  filePath: string;
  newContent: string;
  newServerNames: ReadonlyArray<string>;
}): Promise<void> => {
  const { filePath, newContent, newServerNames } = args;
  let existing = "";
  if (await fileExists(filePath)) {
    existing = await fs.readFile(filePath, "utf-8");
  }
  const stripped = stripExistingMcpTables({
    content: existing,
    serverNames: newServerNames,
  });

  const parts: Array<string> = [];
  if (stripped.length > 0) parts.push(stripped);
  parts.push(newContent.trimEnd());

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${parts.join("\n\n")}\n`);
};

const writeWholeFile = async (args: {
  filePath: string;
  content: string;
}): Promise<void> => {
  const { filePath, content } = args;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content);
};

const writeForScope = async (args: {
  filePath: string;
  format: McpTargetFormat;
  servers: ReadonlyArray<CanonicalMcpServer>;
  mergeStrategy: McpMergeStrategy;
}): Promise<void> => {
  const { filePath, format, servers, mergeStrategy } = args;
  if (servers.length === 0) return;

  const emitted = emitMcpServers({ servers, targetFormat: format });

  if (mergeStrategy === "whole-file") {
    await writeWholeFile({ filePath, content: emitted });
    return;
  }

  if (mergeStrategy === "merge-toml-table") {
    await mergeTomlTables({
      filePath,
      newContent: emitted,
      newServerNames: servers.map((s) => s.name),
    });
    return;
  }

  // merge-mcp-servers-key: load existing JSON, replace the servers under
  // the relevant root key (mcpServers / servers / context_servers).
  const rootKey =
    format === "vscode-json"
      ? "servers"
      : format === "zed-json"
        ? "context_servers"
        : "mcpServers";

  const parsedNew = JSON.parse(emitted) as Record<string, unknown>;
  const newServers = (parsedNew[rootKey] as Record<string, unknown>) ?? {};
  await mergeMcpServersIntoJson({ filePath, rootKey, newServers });
};

export type CreateMcpLoaderArgs = {
  format: McpTargetFormat;
  projectFile: (args: { installDir: string }) => string;
  projectMergeStrategy: McpMergeStrategy;
  userFile: () => string;
  userMergeStrategy: McpMergeStrategy;
};

export const createMcpLoader = (args: CreateMcpLoaderArgs): AgentLoader => {
  const {
    format,
    projectFile,
    projectMergeStrategy,
    userFile,
    userMergeStrategy,
  } = args;

  return {
    name: "mcp",
    description: "Register MCP servers from the active skillset",
    run: async ({ agent, config, skillset }) => {
      if (skillset == null || skillset.mcpDir == null) {
        return;
      }

      const allServers = await readMcpDir({ mcpDir: skillset.mcpDir });
      const filtered = filterByAgent({
        servers: allServers,
        agentName: agent.name,
      });
      if (filtered.length === 0) return;

      const { project, user } = splitByScope({ servers: filtered });

      if (project.length > 0) {
        await writeForScope({
          filePath: projectFile({ installDir: config.installDir }),
          format,
          servers: project,
          mergeStrategy: projectMergeStrategy,
        });
      }

      if (user.length > 0) {
        await writeForScope({
          filePath: userFile(),
          format,
          servers: user,
          mergeStrategy: userMergeStrategy,
        });
      }
    },
  };
};
