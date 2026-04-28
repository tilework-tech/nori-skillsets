/**
 * MCP server config emitter and parser.
 *
 * Translates a canonical MCP server description (the in-skillset shape)
 * into each agent's expected on-disk format, and back. Each agent's MCP
 * config has a different root key, file format (JSON or TOML), and env
 * interpolation syntax — so this module is a single point of branch.
 *
 * Canonical authoring uses ${env:VAR} placeholders. Each emitter rewrites
 * placeholders into the agent's preferred form (Claude/Gemini: ${VAR};
 * Cursor/VSCode/Zed: ${env:VAR} passthrough; Codex: drops placeholders
 * because Codex has no string interpolation).
 */

export type CanonicalAuth =
  | "oauth"
  | { type: "bearer"; tokenEnv: string }
  | null;

export type CanonicalMcpServer = {
  name: string;
  transport: "stdio" | "http" | "sse";
  command?: string | null;
  args?: ReadonlyArray<string> | null;
  url?: string | null;
  env?: Record<string, string> | null;
  headers?: Record<string, string> | null;
  auth?: CanonicalAuth;
  scope?: "project" | "user" | null;
  worksWith?: ReadonlyArray<string> | null;
};

export type McpTargetFormat =
  | "claude-mcp-json"
  | "codex-toml"
  | "gemini-json"
  | "cursor-json"
  | "vscode-json"
  | "zed-json";

const ENV_PLACEHOLDER_REGEX = /\$\{env:([A-Z0-9_]+)\}/g;

const isPlaceholder = (value: string): boolean => {
  return /^\$\{env:[A-Z0-9_]+\}$/.test(value);
};

const rewriteEnvPlaceholders = (args: {
  value: string;
  style: "dollar-brace" | "env-prefix-passthrough";
}): string => {
  const { value, style } = args;
  if (style === "env-prefix-passthrough") {
    return value;
  }
  return value.replace(ENV_PLACEHOLDER_REGEX, "${$1}");
};

const filterEnvForCodex = (args: {
  env?: Record<string, string> | null;
}): Record<string, string> => {
  const { env } = args;
  if (env == null) {
    return {};
  }
  const filtered: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (!isPlaceholder(value)) {
      filtered[key] = value;
    }
  }
  return filtered;
};

const buildJsonServerEntry = (args: {
  server: CanonicalMcpServer;
  envStyle: "dollar-brace" | "env-prefix-passthrough";
}): Record<string, unknown> => {
  const { server, envStyle } = args;
  const entry: Record<string, unknown> = {};

  if (server.transport === "stdio") {
    if (server.command != null) {
      entry.command = server.command;
    }
    if (server.args != null) {
      entry.args = [...server.args];
    }
  } else if (server.url != null) {
    entry.url = server.url;
  }

  if (server.env != null && Object.keys(server.env).length > 0) {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(server.env)) {
      env[k] = rewriteEnvPlaceholders({ value: v, style: envStyle });
    }
    entry.env = env;
  }

  const headers: Record<string, string> = {};
  if (server.headers != null) {
    for (const [k, v] of Object.entries(server.headers)) {
      headers[k] = rewriteEnvPlaceholders({ value: v, style: envStyle });
    }
  }

  if (
    server.auth != null &&
    typeof server.auth === "object" &&
    server.auth.type === "bearer"
  ) {
    headers.Authorization = rewriteEnvPlaceholders({
      value: `Bearer \${env:${server.auth.tokenEnv}}`,
      style: envStyle,
    });
  }
  // OAuth: omit Authorization header — agent runs OAuth flow.

  if (Object.keys(headers).length > 0) {
    entry.headers = headers;
  }

  return entry;
};

const escapeTomlString = (value: string): string => JSON.stringify(value);

const buildCodexServerToml = (args: { server: CanonicalMcpServer }): string => {
  const { server } = args;
  const lines: Array<string> = [`[mcp_servers.${server.name}]`];

  if (server.transport === "stdio") {
    if (server.command != null) {
      lines.push(`command = ${escapeTomlString(server.command)}`);
    }
    if (server.args != null) {
      const arr = server.args.map((a) => escapeTomlString(a)).join(", ");
      lines.push(`args = [${arr}]`);
    }
  } else if (server.url != null) {
    lines.push(`url = ${escapeTomlString(server.url)}`);
  }

  if (
    server.auth != null &&
    typeof server.auth === "object" &&
    server.auth.type === "bearer"
  ) {
    lines.push(
      `bearer_token_env_var = ${escapeTomlString(server.auth.tokenEnv)}`,
    );
  }

  // Codex stdio env block: drop placeholder values, keep literals.
  const literalEnv = filterEnvForCodex({ env: server.env });
  if (Object.keys(literalEnv).length > 0) {
    lines.push("");
    lines.push(`[mcp_servers.${server.name}.env]`);
    for (const [k, v] of Object.entries(literalEnv)) {
      lines.push(`${k} = ${escapeTomlString(v)}`);
    }
  }

  return lines.join("\n");
};

export const emitMcpServers = (args: {
  servers: ReadonlyArray<CanonicalMcpServer>;
  targetFormat: McpTargetFormat;
}): string => {
  const { servers, targetFormat } = args;

  if (targetFormat === "codex-toml") {
    return servers
      .map((s) => buildCodexServerToml({ server: s }))
      .join("\n\n")
      .concat("\n");
  }

  const envStyle =
    targetFormat === "claude-mcp-json" || targetFormat === "gemini-json"
      ? "dollar-brace"
      : "env-prefix-passthrough";

  const entries: Record<string, unknown> = {};
  for (const s of servers) {
    entries[s.name] = buildJsonServerEntry({ server: s, envStyle });
  }

  const rootKey =
    targetFormat === "vscode-json"
      ? "servers"
      : targetFormat === "zed-json"
        ? "context_servers"
        : "mcpServers";

  return `${JSON.stringify({ [rootKey]: entries }, null, 2)}\n`;
};

// ----- Parsers (inverse of emit) ------------------------------------------

const canonicalizeEnv = (args: {
  env?: Record<string, unknown> | null;
}): Record<string, string> => {
  const { env } = args;
  if (env == null) {
    return {};
  }
  const result: Record<string, string> = {};
  for (const [key, raw] of Object.entries(env)) {
    if (typeof raw !== "string") continue;
    // Normalize ${VAR} or $VAR to canonical ${env:VAR}
    const normalized = raw
      .replace(/\$\{([A-Z0-9_]+)\}/g, "${env:$1}")
      .replace(/(^|[^${])\$([A-Z][A-Z0-9_]*)/g, "$1${env:$2}");
    result[key] = normalized;
  }
  return result;
};

const parseBearerFromHeaders = (args: {
  headers?: Record<string, unknown> | null;
}): { tokenEnv: string } | null => {
  const { headers } = args;
  if (headers == null) return null;
  const auth = headers.Authorization ?? headers.authorization;
  if (typeof auth !== "string") return null;
  const m = auth.match(/Bearer\s+\$\{(?:env:)?([A-Z0-9_]+)\}/);
  if (m == null) return null;
  return { tokenEnv: m[1] };
};

const parseJsonRoot = (args: {
  content: string;
  rootKey: string;
}): Record<string, Record<string, unknown>> => {
  const { content, rootKey } = args;
  const parsed = JSON.parse(content) as Record<string, unknown>;
  const root = parsed[rootKey];
  if (root == null || typeof root !== "object") {
    return {};
  }
  return root as Record<string, Record<string, unknown>>;
};

const parseJsonServers = (args: {
  content: string;
  rootKey: string;
}): Array<CanonicalMcpServer> => {
  const root = parseJsonRoot(args);
  const result: Array<CanonicalMcpServer> = [];

  for (const [name, raw] of Object.entries(root)) {
    if (raw == null || typeof raw !== "object") continue;
    const entry = raw as Record<string, unknown>;

    const transport: "stdio" | "http" =
      typeof entry.url === "string" ? "http" : "stdio";

    const server: CanonicalMcpServer = { name, transport };

    if (transport === "stdio") {
      if (typeof entry.command === "string") {
        server.command = entry.command;
      }
      if (Array.isArray(entry.args)) {
        server.args = entry.args.filter(
          (a): a is string => typeof a === "string",
        );
      }
    } else {
      server.url = entry.url as string;
    }

    const env = canonicalizeEnv({
      env: entry.env as Record<string, unknown> | null | undefined,
    });
    if (Object.keys(env).length > 0) {
      server.env = env;
    }

    const bearer = parseBearerFromHeaders({
      headers: entry.headers as Record<string, unknown> | null | undefined,
    });
    if (bearer != null) {
      server.auth = { type: "bearer", tokenEnv: bearer.tokenEnv };
    }

    result.push(server);
  }
  return result;
};

const parseCodexToml = (args: {
  content: string;
}): Array<CanonicalMcpServer> => {
  const { content } = args;
  const result: Array<CanonicalMcpServer> = [];

  // Captured group only matches [A-Za-z0-9_-]+ which excludes "." so this
  // never matches the [mcp_servers.X.env] subtable as a main entry.
  const tableRegex =
    /\[mcp_servers\.([A-Za-z0-9_-]+)\]([\s\S]*?)(?=\n\[mcp_servers\.|\n\[[^\]]+\]|$)/g;
  const envTableRegex =
    /\[mcp_servers\.([A-Za-z0-9_-]+)\.env\]([\s\S]*?)(?=\n\[|$)/g;

  const tables = new Map<string, string>();
  let match: RegExpExecArray | null;
  while ((match = tableRegex.exec(content)) !== null) {
    tables.set(match[1], match[2]);
  }

  const envTables = new Map<string, string>();
  while ((match = envTableRegex.exec(content)) !== null) {
    envTables.set(match[1], match[2]);
  }

  for (const [name, body] of tables) {
    const commandMatch = body.match(/^\s*command\s*=\s*"([^"]*)"/m);
    const argsMatch = body.match(/^\s*args\s*=\s*\[(.*?)\]/ms);
    const urlMatch = body.match(/^\s*url\s*=\s*"([^"]*)"/m);
    const bearerMatch = body.match(/^\s*bearer_token_env_var\s*=\s*"([^"]*)"/m);

    const transport: "stdio" | "http" = urlMatch != null ? "http" : "stdio";

    const server: CanonicalMcpServer = { name, transport };

    if (transport === "stdio") {
      if (commandMatch != null) {
        server.command = commandMatch[1];
      }
      if (argsMatch != null) {
        const items = argsMatch[1]
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
          .map((s) => {
            const m = s.match(/^"([^"]*)"$/);
            return m != null ? m[1] : s;
          });
        server.args = items;
      }
    } else if (urlMatch != null) {
      server.url = urlMatch[1];
    }

    if (bearerMatch != null) {
      server.auth = { type: "bearer", tokenEnv: bearerMatch[1] };
    }

    const envBody = envTables.get(name);
    if (envBody != null) {
      const env: Record<string, string> = {};
      const envLineRegex = /^\s*([A-Z0-9_]+)\s*=\s*"([^"]*)"/gm;
      let envMatch: RegExpExecArray | null;
      while ((envMatch = envLineRegex.exec(envBody)) !== null) {
        env[envMatch[1]] = envMatch[2];
      }
      if (Object.keys(env).length > 0) {
        server.env = env;
      }
    }

    result.push(server);
  }

  return result;
};

export const parseAgentConfig = (args: {
  content: string;
  format: McpTargetFormat;
}): Array<CanonicalMcpServer> => {
  const { content, format } = args;
  if (format === "codex-toml") {
    return parseCodexToml({ content });
  }

  const rootKey =
    format === "vscode-json"
      ? "servers"
      : format === "zed-json"
        ? "context_servers"
        : "mcpServers";

  return parseJsonServers({ content, rootKey });
};
