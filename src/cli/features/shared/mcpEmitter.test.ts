/**
 * Tests for MCP server config emitter.
 *
 * Verifies that canonical MCP server definitions are translated to the
 * correct on-the-wire format for each agent. Tests parse the emitted
 * string with the agent's expected loader semantics (JSON parse or
 * TOML key match) and check structural properties — not the canonical
 * type's internal shape.
 */

import { describe, it, expect } from "vitest";

import {
  emitMcpServers,
  parseAgentConfig,
  type CanonicalMcpServer,
} from "@/cli/features/shared/mcpEmitter.js";

const stdioGithub: CanonicalMcpServer = {
  name: "github",
  transport: "stdio",
  command: "npx",
  args: ["-y", "@modelcontextprotocol/server-github"],
  env: { GITHUB_TOKEN: "${env:GITHUB_TOKEN}" },
};

const httpStripe: CanonicalMcpServer = {
  name: "stripe",
  transport: "http",
  url: "https://mcp.stripe.com",
  auth: { type: "bearer", tokenEnv: "STRIPE_API_KEY" },
};

const oauthLinear: CanonicalMcpServer = {
  name: "linear",
  transport: "http",
  url: "https://mcp.linear.app/sse",
  auth: "oauth",
};

describe("emitMcpServers — claude-mcp-json", () => {
  it("emits stdio server under mcpServers with ${VAR} env interpolation", () => {
    const out = emitMcpServers({
      servers: [stdioGithub],
      targetFormat: "claude-mcp-json",
    });

    const parsed = JSON.parse(out);
    expect(parsed.mcpServers.github.command).toBe("npx");
    expect(parsed.mcpServers.github.args).toEqual([
      "-y",
      "@modelcontextprotocol/server-github",
    ]);
    expect(parsed.mcpServers.github.env.GITHUB_TOKEN).toBe("${GITHUB_TOKEN}");
  });

  it("emits HTTP bearer auth as Authorization header with ${VAR}", () => {
    const out = emitMcpServers({
      servers: [httpStripe],
      targetFormat: "claude-mcp-json",
    });
    const parsed = JSON.parse(out);
    expect(parsed.mcpServers.stripe.url).toBe("https://mcp.stripe.com");
    expect(parsed.mcpServers.stripe.headers.Authorization).toBe(
      "Bearer ${STRIPE_API_KEY}",
    );
  });

  it("omits Authorization header for OAuth servers", () => {
    const out = emitMcpServers({
      servers: [oauthLinear],
      targetFormat: "claude-mcp-json",
    });
    const parsed = JSON.parse(out);
    expect(parsed.mcpServers.linear.url).toBe("https://mcp.linear.app/sse");
    const headers = parsed.mcpServers.linear.headers ?? {};
    expect(headers.Authorization).toBeUndefined();
  });
});

describe("emitMcpServers — codex-toml", () => {
  it("emits stdio server as [mcp_servers.<name>] table with command/args", () => {
    const out = emitMcpServers({
      servers: [stdioGithub],
      targetFormat: "codex-toml",
    });

    expect(out).toContain("[mcp_servers.github]");
    expect(out).toMatch(/command\s*=\s*"npx"/);
    expect(out).toMatch(/args\s*=\s*\[\s*"-y"/);
  });

  it("does not emit env entries containing ${env:...} placeholders (Codex has no interpolation)", () => {
    const out = emitMcpServers({
      servers: [stdioGithub],
      targetFormat: "codex-toml",
    });

    // No literal ${env:GITHUB_TOKEN} should appear — Codex would treat that as
    // a literal string and break auth. Placeholder values are dropped; user is
    // expected to export the var in their shell.
    expect(out).not.toContain("${env:GITHUB_TOKEN}");
    expect(out).not.toContain("${GITHUB_TOKEN}");
  });

  it('emits HTTP bearer auth using bearer_token_env_var = "NAME"', () => {
    const out = emitMcpServers({
      servers: [httpStripe],
      targetFormat: "codex-toml",
    });

    expect(out).toContain("[mcp_servers.stripe]");
    expect(out).toMatch(/url\s*=\s*"https:\/\/mcp\.stripe\.com"/);
    expect(out).toMatch(/bearer_token_env_var\s*=\s*"STRIPE_API_KEY"/);
  });

  it("emits HTTP OAuth server without bearer_token_env_var", () => {
    const out = emitMcpServers({
      servers: [oauthLinear],
      targetFormat: "codex-toml",
    });

    expect(out).toContain("[mcp_servers.linear]");
    expect(out).not.toContain("bearer_token_env_var");
  });

  it("preserves literal env values that are not ${env:...} placeholders", () => {
    const out = emitMcpServers({
      servers: [
        {
          name: "configured",
          transport: "stdio",
          command: "node",
          args: ["server.js"],
          env: { LOG_LEVEL: "debug" },
        },
      ],
      targetFormat: "codex-toml",
    });

    expect(out).toMatch(/\[mcp_servers\.configured\.env\]/);
    expect(out).toMatch(/LOG_LEVEL\s*=\s*"debug"/);
  });
});

describe("emitMcpServers — cursor-json", () => {
  it("emits stdio server under mcpServers with ${env:VAR} env interpolation (passthrough)", () => {
    const out = emitMcpServers({
      servers: [stdioGithub],
      targetFormat: "cursor-json",
    });

    const parsed = JSON.parse(out);
    expect(parsed.mcpServers.github.command).toBe("npx");
    expect(parsed.mcpServers.github.env.GITHUB_TOKEN).toBe(
      "${env:GITHUB_TOKEN}",
    );
  });
});

describe("emitMcpServers — vscode-json", () => {
  it("uses 'servers' as the root key (not 'mcpServers')", () => {
    const out = emitMcpServers({
      servers: [stdioGithub],
      targetFormat: "vscode-json",
    });

    const parsed = JSON.parse(out);
    expect(parsed.mcpServers).toBeUndefined();
    expect(parsed.servers.github.command).toBe("npx");
  });
});

describe("emitMcpServers — zed-json", () => {
  it("uses 'context_servers' as the root key (not 'mcpServers')", () => {
    const out = emitMcpServers({
      servers: [stdioGithub],
      targetFormat: "zed-json",
    });

    const parsed = JSON.parse(out);
    expect(parsed.mcpServers).toBeUndefined();
    expect(parsed.context_servers.github.command).toBe("npx");
  });
});

describe("parseAgentConfig — claude-mcp-json", () => {
  it("parses an mcp.json file into canonical server entries", () => {
    const content = JSON.stringify({
      mcpServers: {
        github: {
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-github"],
          env: { GITHUB_TOKEN: "${GITHUB_TOKEN}" },
        },
      },
    });

    const servers = parseAgentConfig({
      content,
      format: "claude-mcp-json",
    });

    expect(servers).toHaveLength(1);
    expect(servers[0].name).toBe("github");
    expect(servers[0].transport).toBe("stdio");
    expect(servers[0].command).toBe("npx");
    expect(servers[0].env?.GITHUB_TOKEN).toBe("${env:GITHUB_TOKEN}");
  });

  it("parses HTTP server with Authorization header into bearer auth", () => {
    const content = JSON.stringify({
      mcpServers: {
        stripe: {
          url: "https://mcp.stripe.com",
          headers: { Authorization: "Bearer ${STRIPE_API_KEY}" },
        },
      },
    });

    const servers = parseAgentConfig({
      content,
      format: "claude-mcp-json",
    });

    expect(servers).toHaveLength(1);
    expect(servers[0].transport).toBe("http");
    expect(servers[0].url).toBe("https://mcp.stripe.com");
    expect(servers[0].auth).toEqual({
      type: "bearer",
      tokenEnv: "STRIPE_API_KEY",
    });
  });
});

describe("parseAgentConfig — codex-toml", () => {
  it("parses [mcp_servers.<name>] tables into canonical server entries", () => {
    const content = [
      "[mcp_servers.github]",
      'command = "npx"',
      'args = ["-y", "@modelcontextprotocol/server-github"]',
      "",
      "[mcp_servers.stripe]",
      'url = "https://mcp.stripe.com"',
      'bearer_token_env_var = "STRIPE_API_KEY"',
      "",
    ].join("\n");

    const servers = parseAgentConfig({
      content,
      format: "codex-toml",
    });

    expect(servers).toHaveLength(2);

    const github = servers.find((s) => s.name === "github");
    expect(github?.transport).toBe("stdio");
    expect(github?.command).toBe("npx");
    expect(github?.args).toEqual(["-y", "@modelcontextprotocol/server-github"]);

    const stripe = servers.find((s) => s.name === "stripe");
    expect(stripe?.transport).toBe("http");
    expect(stripe?.url).toBe("https://mcp.stripe.com");
    expect(stripe?.auth).toEqual({
      type: "bearer",
      tokenEnv: "STRIPE_API_KEY",
    });
  });
});
