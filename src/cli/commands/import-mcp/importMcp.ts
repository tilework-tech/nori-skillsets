/**
 * import-mcp command
 *
 * Scans known on-disk MCP config locations (Claude `.mcp.json`, Codex
 * `~/.codex/config.toml`, Gemini `settings.json`, Cursor `mcp.json`,
 * VS Code `.vscode/mcp.json`) and imports any servers found into the
 * named skillset's `mcp/<server>.json` directory.
 *
 * Sanitizes literal-looking secrets to `${env:VAR}` placeholders so the
 * skillset is safe to share, and auto-derives `requiredEnv` in
 * `nori.json` from the placeholders found.
 */

import * as fs from "fs/promises";
import * as path from "path";

import { isCancel, log, note, select } from "@clack/prompts";

import {
  parseAgentConfig,
  type CanonicalMcpServer,
  type McpTargetFormat,
} from "@/cli/features/shared/mcpEmitter.js";
import {
  readSkillsetMetadata,
  writeSkillsetMetadata,
  type NoriJson,
} from "@/norijson/nori.js";
import { getNoriSkillsetsDir, listSkillsets } from "@/norijson/skillset.js";
import { getHomeDir } from "@/utils/home.js";

import type { CommandStatus } from "@/cli/commands/commandStatus.js";

type ScanCandidate = {
  filePath: string;
  format: McpTargetFormat;
};

type ImportedServer = {
  server: CanonicalMcpServer;
  source: string;
  sanitizedKeys: Array<string>;
};

const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
};

const buildScanCandidates = (): Array<ScanCandidate> => {
  const home = getHomeDir();
  const cwd = process.cwd();
  return [
    { filePath: path.join(cwd, ".mcp.json"), format: "claude-mcp-json" },
    { filePath: path.join(home, ".claude.json"), format: "claude-mcp-json" },
    {
      filePath: path.join(home, ".codex", "config.toml"),
      format: "codex-toml",
    },
    {
      filePath: path.join(cwd, ".codex", "config.toml"),
      format: "codex-toml",
    },
    {
      filePath: path.join(cwd, ".gemini", "settings.json"),
      format: "gemini-json",
    },
    {
      filePath: path.join(home, ".gemini", "settings.json"),
      format: "gemini-json",
    },
    { filePath: path.join(cwd, ".cursor", "mcp.json"), format: "cursor-json" },
    { filePath: path.join(home, ".cursor", "mcp.json"), format: "cursor-json" },
    { filePath: path.join(cwd, ".vscode", "mcp.json"), format: "vscode-json" },
  ];
};

const TOKEN_PATTERN = /[A-Za-z0-9_\-+/=]{20,}/;

const looksLikeLiteralSecret = (value: string): boolean => {
  // ${...} placeholders are already-safe; same for plain $VAR references.
  if (value.includes("${") || /(^|\s)\$[A-Z_]/.test(value)) {
    return false;
  }
  if (!TOKEN_PATTERN.test(value)) return false;
  // Tighten the heuristic: real tokens (PATs, API keys) almost always contain
  // both letters AND digits. Package names like "@scope/pkg-name" pass the
  // length check but rarely contain digits, which keeps them out of scope.
  return /\d/.test(value) && /[A-Za-z]/.test(value);
};

const sanitizeMap = (args: {
  values: Record<string, string> | null | undefined;
  serverName: string;
  field: "env" | "headers";
}): {
  values: Record<string, string> | null;
  sanitizedKeys: Array<string>;
} => {
  const { values, field } = args;
  if (values == null) {
    return { values: null, sanitizedKeys: [] };
  }
  const next: Record<string, string> = {};
  const sanitizedKeys: Array<string> = [];
  for (const [key, value] of Object.entries(values)) {
    if (looksLikeLiteralSecret(value)) {
      // Use the dictionary key as the env-var name for env; prefix with
      // SECRET_ for headers since header names like "Authorization" are
      // poor env-var names.
      const envName =
        field === "env"
          ? key
          : `SECRET_${key.toUpperCase().replace(/[^A-Z0-9_]/g, "_")}`;
      next[key] = `\${env:${envName}}`;
      sanitizedKeys.push(key);
    } else {
      next[key] = value;
    }
  }
  return { values: next, sanitizedKeys };
};

const sanitizeArgs = (args: {
  argList?: ReadonlyArray<string> | null;
  serverName: string;
}): { argList: ReadonlyArray<string> | null; sanitizedCount: number } => {
  const { argList, serverName } = args;
  if (argList == null) return { argList: null, sanitizedCount: 0 };
  let sanitizedCount = 0;
  let counter = 0;
  const next = argList.map((arg) => {
    if (looksLikeLiteralSecret(arg)) {
      counter += 1;
      sanitizedCount += 1;
      const envName = `${serverName.toUpperCase().replace(/[^A-Z0-9_]/g, "_")}_ARG_${counter}`;
      return `\${env:${envName}}`;
    }
    return arg;
  });
  return { argList: next, sanitizedCount };
};

const sanitizeServer = (args: {
  server: CanonicalMcpServer;
}): { server: CanonicalMcpServer; sanitizedKeys: Array<string> } => {
  const { server } = args;
  const sanitizedKeys: Array<string> = [];

  const env = sanitizeMap({
    values: server.env,
    serverName: server.name,
    field: "env",
  });
  sanitizedKeys.push(...env.sanitizedKeys);

  const headers = sanitizeMap({
    values: server.headers,
    serverName: server.name,
    field: "headers",
  });
  sanitizedKeys.push(...headers.sanitizedKeys.map((k) => `headers.${k}`));

  const argList = sanitizeArgs({
    argList: server.args,
    serverName: server.name,
  });
  if (argList.sanitizedCount > 0) {
    sanitizedKeys.push(`args[${argList.sanitizedCount} value(s)]`);
  }

  return {
    server: {
      ...server,
      env: env.values ?? server.env,
      headers: headers.values ?? server.headers,
      args: argList.argList ?? server.args,
    },
    sanitizedKeys,
  };
};

const collectServersFromFile = async (args: {
  candidate: ScanCandidate;
}): Promise<Array<CanonicalMcpServer>> => {
  const { candidate } = args;
  if (!(await fileExists(candidate.filePath))) {
    return [];
  }

  let content: string;
  try {
    content = await fs.readFile(candidate.filePath, "utf-8");
  } catch {
    return [];
  }

  try {
    return parseAgentConfig({ content, format: candidate.format });
  } catch (err) {
    log.warn(
      `Skipping ${candidate.filePath}: failed to parse (${err instanceof Error ? err.message : String(err)})`,
    );
    return [];
  }
};

const dedupeByName = (args: {
  imported: ReadonlyArray<ImportedServer>;
}): Array<ImportedServer> => {
  const { imported } = args;
  const byName = new Map<string, ImportedServer>();
  for (const entry of imported) {
    if (!byName.has(entry.server.name)) {
      byName.set(entry.server.name, entry);
    } else {
      log.warn(
        `Server '${entry.server.name}' found in ${entry.source} but already imported from ${byName.get(entry.server.name)!.source}; keeping first.`,
      );
    }
  }
  return Array.from(byName.values());
};

const findEnvPlaceholders = (args: {
  servers: ReadonlyArray<CanonicalMcpServer>;
}): Array<string> => {
  const { servers } = args;
  const found = new Set<string>();
  const re = /\$\{env:([A-Z0-9_]+)\}/g;
  for (const s of servers) {
    if (
      s.auth != null &&
      typeof s.auth === "object" &&
      s.auth.type === "bearer"
    ) {
      // auth.type=bearer references tokenEnv for HTTP servers
      found.add(s.auth.tokenEnv);
    }
    if (s.env != null) {
      for (const value of Object.values(s.env)) {
        let match: RegExpExecArray | null;
        re.lastIndex = 0;
        while ((match = re.exec(value)) !== null) {
          found.add(match[1]);
        }
      }
    }
    if (s.headers != null) {
      for (const value of Object.values(s.headers)) {
        let match: RegExpExecArray | null;
        re.lastIndex = 0;
        while ((match = re.exec(value)) !== null) {
          found.add(match[1]);
        }
      }
    }
  }
  return Array.from(found).sort();
};

const mergeRequiredEnv = (args: {
  metadata: NoriJson;
  derivedNames: ReadonlyArray<string>;
}): NoriJson => {
  const { metadata, derivedNames } = args;
  const existingRaw = (metadata as { requiredEnv?: unknown }).requiredEnv;
  const existing = Array.isArray(existingRaw) ? existingRaw : [];

  const seen = new Set<string>();
  const merged: Array<unknown> = [];

  for (const entry of existing) {
    let name: string | null = null;
    if (typeof entry === "string") {
      name = entry;
    } else if (typeof entry === "object" && entry != null) {
      const n = (entry as { name?: unknown }).name;
      if (typeof n === "string") name = n;
    }
    if (name == null) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    merged.push(entry);
  }

  for (const name of derivedNames) {
    if (seen.has(name)) continue;
    seen.add(name);
    merged.push({ name });
  }

  return { ...metadata, requiredEnv: merged } as NoriJson;
};

const promptForSkillsetName = async (): Promise<string | null> => {
  const skillsets = await listSkillsets();
  if (skillsets.length === 0) {
    log.error("No skillsets found. Create one with `nori-skillsets new`.");
    return null;
  }

  const selection = await select({
    message: "Which skillset should the imported MCP configs go into?",
    options: skillsets.map((name) => ({ value: name, label: name })),
  });
  if (isCancel(selection)) {
    return null;
  }
  return selection as string;
};

export const importMcpMain = async (args: {
  skillsetName: string | null;
  nonInteractive?: boolean | null;
}): Promise<CommandStatus> => {
  const { nonInteractive } = args;
  let skillsetName = args.skillsetName;

  if (skillsetName == null) {
    if (nonInteractive) {
      return {
        success: false,
        cancelled: false,
        message: "skillset-name argument is required in non-interactive mode",
      };
    }
    const picked = await promptForSkillsetName();
    if (picked == null) {
      return { success: false, cancelled: true, message: "" };
    }
    skillsetName = picked;
  }

  const skillsetDir = path.join(getNoriSkillsetsDir(), skillsetName);
  if (!(await fileExists(skillsetDir))) {
    return {
      success: false,
      cancelled: false,
      message: `Skillset '${skillsetName}' not found.`,
    };
  }

  // Collect from every known candidate path
  const candidates = buildScanCandidates();
  const imported: Array<ImportedServer> = [];
  for (const candidate of candidates) {
    const servers = await collectServersFromFile({ candidate });
    for (const raw of servers) {
      const { server, sanitizedKeys } = sanitizeServer({ server: raw });
      imported.push({
        server,
        source: candidate.filePath,
        sanitizedKeys,
      });
    }
  }

  if (imported.length === 0) {
    return {
      success: true,
      cancelled: false,
      message: "No MCP server configurations found in known agent locations.",
    };
  }

  const deduped = dedupeByName({ imported });

  // Write each server to mcp/<name>.json
  const mcpDir = path.join(skillsetDir, "mcp");
  await fs.mkdir(mcpDir, { recursive: true });
  for (const entry of deduped) {
    const filePath = path.join(mcpDir, `${entry.server.name}.json`);
    await fs.writeFile(filePath, `${JSON.stringify(entry.server, null, 2)}\n`);
    if (entry.sanitizedKeys.length > 0) {
      log.warn(
        `Sanitized literal secret(s) in ${entry.server.name}: ${entry.sanitizedKeys.join(", ")} → ${"$"}{env:VAR}. Review ${filePath} before publishing.`,
      );
    }
  }

  // Auto-derive requiredEnv into nori.json
  const derived = findEnvPlaceholders({
    servers: deduped.map((e) => e.server),
  });
  const metadata = await readSkillsetMetadata({ skillsetDir });
  const updated = mergeRequiredEnv({ metadata, derivedNames: derived });
  await writeSkillsetMetadata({ skillsetDir, metadata: updated });

  const summaryLines = deduped.map(
    (e) => `+ ${e.server.name} (from ${path.relative(getHomeDir(), e.source)})`,
  );
  if (derived.length > 0) {
    summaryLines.push("", `Required env: ${derived.join(", ")}`);
  }
  note(summaryLines.join("\n"), "Imported MCP servers");

  return {
    success: true,
    cancelled: false,
    message: `Imported ${deduped.length} MCP server${deduped.length === 1 ? "" : "s"} into '${skillsetName}'.`,
  };
};
