/**
 * Tests for import-mcp command.
 *
 * Verifies that scanning known agent config locations on disk produces
 * canonical MCP server files inside ~/.nori/profiles/<skillset>/mcp/,
 * and that nori.json gets a sensible auto-derived requiredEnv list.
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { importMcpMain } from "@/cli/commands/import-mcp/importMcp.js";

vi.mock("os", async (importOriginal) => {
  const actual = await importOriginal<typeof os>();
  return {
    ...actual,
    homedir: vi.fn().mockReturnValue(actual.homedir()),
  };
});

vi.mock("@clack/prompts", () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
  },
  note: vi.fn(),
  select: vi.fn(),
  isCancel: () => false,
  outro: vi.fn(),
}));

const writeJson = async (args: {
  filePath: string;
  body: unknown;
}): Promise<void> => {
  const { filePath, body } = args;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(body, null, 2));
};

describe("importMcpMain — discovers MCP configs in agent locations", () => {
  let testHome: string;
  let cwd: string;
  let originalCwd: string;
  let skillsetDir: string;

  beforeEach(async () => {
    testHome = await fs.mkdtemp(path.join(os.tmpdir(), "import-mcp-test-"));
    vi.mocked(os.homedir).mockReturnValue(testHome);

    cwd = path.join(testHome, "project");
    await fs.mkdir(cwd, { recursive: true });
    originalCwd = process.cwd();
    process.chdir(cwd);

    skillsetDir = path.join(testHome, ".nori", "profiles", "test-skillset");
    await fs.mkdir(skillsetDir, { recursive: true });
    await fs.writeFile(
      path.join(skillsetDir, "nori.json"),
      JSON.stringify({ name: "test-skillset", version: "1.0.0" }),
    );
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await fs.rm(testHome, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("imports stdio servers from cwd/.mcp.json into the skillset's mcp dir", async () => {
    await writeJson({
      filePath: path.join(cwd, ".mcp.json"),
      body: {
        mcpServers: {
          alpha: {
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-alpha"],
            env: { ALPHA_KEY: "${ALPHA_KEY}" },
          },
          beta: {
            command: "node",
            args: ["beta.js"],
          },
        },
      },
    });

    const result = await importMcpMain({
      skillsetName: "test-skillset",
      nonInteractive: true,
    });

    expect(result.success).toBe(true);

    const alphaPath = path.join(skillsetDir, "mcp", "alpha.json");
    const betaPath = path.join(skillsetDir, "mcp", "beta.json");

    const alpha = JSON.parse(await fs.readFile(alphaPath, "utf-8"));
    const beta = JSON.parse(await fs.readFile(betaPath, "utf-8"));

    expect(alpha.name).toBe("alpha");
    expect(alpha.transport).toBe("stdio");
    expect(alpha.command).toBe("npx");
    expect(alpha.env.ALPHA_KEY).toBe("${env:ALPHA_KEY}");

    expect(beta.name).toBe("beta");
    expect(beta.command).toBe("node");
  });

  it("imports stdio servers from ~/.codex/config.toml", async () => {
    const codexConfig = path.join(testHome, ".codex", "config.toml");
    await fs.mkdir(path.dirname(codexConfig), { recursive: true });
    await fs.writeFile(
      codexConfig,
      [
        "[mcp_servers.toml-server]",
        'command = "node"',
        'args = ["server.js"]',
        "",
      ].join("\n"),
    );

    const result = await importMcpMain({
      skillsetName: "test-skillset",
      nonInteractive: true,
    });

    expect(result.success).toBe(true);
    const imported = JSON.parse(
      await fs.readFile(
        path.join(skillsetDir, "mcp", "toml-server.json"),
        "utf-8",
      ),
    );
    expect(imported.command).toBe("node");
    expect(imported.args).toEqual(["server.js"]);
  });

  it("sanitizes literal-looking tokens embedded in headers (e.g., Bearer <token>)", async () => {
    await writeJson({
      filePath: path.join(cwd, ".mcp.json"),
      body: {
        mcpServers: {
          remote: {
            url: "https://example.com/mcp",
            headers: {
              Authorization: "Bearer ghp_abcdef0123456789ABCDEFGHIJKLMNOP",
            },
          },
        },
      },
    });

    await importMcpMain({
      skillsetName: "test-skillset",
      nonInteractive: true,
    });

    const fileContent = await fs.readFile(
      path.join(skillsetDir, "mcp", "remote.json"),
      "utf-8",
    );
    expect(fileContent).not.toContain("ghp_abcdef0123456789ABCDEFGHIJKLMNOP");
  });

  it("does not sanitize package-name-like args without digit characters", async () => {
    await writeJson({
      filePath: path.join(cwd, ".mcp.json"),
      body: {
        mcpServers: {
          pkg: {
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-filesystem"],
          },
        },
      },
    });

    await importMcpMain({
      skillsetName: "test-skillset",
      nonInteractive: true,
    });

    const imported = JSON.parse(
      await fs.readFile(path.join(skillsetDir, "mcp", "pkg.json"), "utf-8"),
    );
    expect(imported.args).toEqual([
      "-y",
      "@modelcontextprotocol/server-filesystem",
    ]);
  });

  it("sanitizes literal-looking tokens embedded in args", async () => {
    await writeJson({
      filePath: path.join(cwd, ".mcp.json"),
      body: {
        mcpServers: {
          argful: {
            command: "node",
            args: ["server.js", "ghp_abcdef0123456789ABCDEFGHIJKLMNOP"],
          },
        },
      },
    });

    await importMcpMain({
      skillsetName: "test-skillset",
      nonInteractive: true,
    });

    const fileContent = await fs.readFile(
      path.join(skillsetDir, "mcp", "argful.json"),
      "utf-8",
    );
    expect(fileContent).not.toContain("ghp_abcdef0123456789ABCDEFGHIJKLMNOP");
  });

  it("sanitizes literal-looking secrets to ${env:VAR} placeholders", async () => {
    await writeJson({
      filePath: path.join(cwd, ".mcp.json"),
      body: {
        mcpServers: {
          leaky: {
            command: "node",
            args: ["server.js"],
            env: { GITHUB_TOKEN: "ghp_abcdef0123456789ABCDEFGHIJKLMNOP" },
          },
        },
      },
    });

    const result = await importMcpMain({
      skillsetName: "test-skillset",
      nonInteractive: true,
    });

    expect(result.success).toBe(true);
    const imported = JSON.parse(
      await fs.readFile(path.join(skillsetDir, "mcp", "leaky.json"), "utf-8"),
    );
    expect(imported.env.GITHUB_TOKEN).toBe("${env:GITHUB_TOKEN}");
    // Bundled file MUST NOT contain the literal token
    const fileContent = await fs.readFile(
      path.join(skillsetDir, "mcp", "leaky.json"),
      "utf-8",
    );
    expect(fileContent).not.toContain("ghp_abcdef0123456789ABCDEFGHIJKLMNOP");
  });

  it("auto-derives requiredEnv into nori.json from ${env:VAR} references", async () => {
    await writeJson({
      filePath: path.join(cwd, ".mcp.json"),
      body: {
        mcpServers: {
          one: {
            command: "node",
            args: ["o.js"],
            env: { GITHUB_TOKEN: "${GITHUB_TOKEN}" },
          },
          two: {
            command: "node",
            args: ["t.js"],
            env: { STRIPE_API_KEY: "${STRIPE_API_KEY}" },
          },
        },
      },
    });

    await importMcpMain({
      skillsetName: "test-skillset",
      nonInteractive: true,
    });

    const noriJson = JSON.parse(
      await fs.readFile(path.join(skillsetDir, "nori.json"), "utf-8"),
    );

    const requiredEnvNames = (noriJson.requiredEnv ?? []).map(
      (entry: unknown) =>
        typeof entry === "string" ? entry : (entry as { name: string }).name,
    );
    expect(requiredEnvNames.sort()).toEqual(
      ["GITHUB_TOKEN", "STRIPE_API_KEY"].sort(),
    );
  });

  it("preserves existing requiredEnv enrichments (description/url) on re-import", async () => {
    await fs.writeFile(
      path.join(skillsetDir, "nori.json"),
      JSON.stringify({
        name: "test-skillset",
        version: "1.0.0",
        requiredEnv: [
          {
            name: "GITHUB_TOKEN",
            description: "PAT with repo scope",
            url: "https://github.com/settings/tokens",
          },
        ],
      }),
    );

    await writeJson({
      filePath: path.join(cwd, ".mcp.json"),
      body: {
        mcpServers: {
          x: {
            command: "node",
            args: ["x.js"],
            env: { GITHUB_TOKEN: "${GITHUB_TOKEN}" },
          },
        },
      },
    });

    await importMcpMain({
      skillsetName: "test-skillset",
      nonInteractive: true,
    });

    const noriJson = JSON.parse(
      await fs.readFile(path.join(skillsetDir, "nori.json"), "utf-8"),
    );

    const githubEntry = (noriJson.requiredEnv ?? []).find(
      (entry: unknown) =>
        typeof entry === "object" &&
        entry !== null &&
        (entry as { name: string }).name === "GITHUB_TOKEN",
    ) as { description?: string; url?: string } | undefined;

    expect(githubEntry?.description).toBe("PAT with repo scope");
    expect(githubEntry?.url).toBe("https://github.com/settings/tokens");
  });

  it("returns success and writes nothing when no MCP files are found", async () => {
    const result = await importMcpMain({
      skillsetName: "test-skillset",
      nonInteractive: true,
    });

    expect(result.success).toBe(true);

    const mcpDirExists = await fs
      .access(path.join(skillsetDir, "mcp"))
      .then(() => true)
      .catch(() => false);
    expect(mcpDirExists).toBe(false);
  });

  it("does not write the same server twice when found in two locations (first wins)", async () => {
    // Two locations both define a server named "shared"
    await writeJson({
      filePath: path.join(cwd, ".mcp.json"),
      body: {
        mcpServers: {
          shared: { command: "from-claude", args: [] },
        },
      },
    });
    const codexConfig = path.join(testHome, ".codex", "config.toml");
    await fs.mkdir(path.dirname(codexConfig), { recursive: true });
    await fs.writeFile(
      codexConfig,
      ["[mcp_servers.shared]", 'command = "from-codex"', "args = []", ""].join(
        "\n",
      ),
    );

    await importMcpMain({
      skillsetName: "test-skillset",
      nonInteractive: true,
    });

    const sharedFiles = await fs.readdir(path.join(skillsetDir, "mcp"));
    const sharedEntries = sharedFiles.filter((n) => n.startsWith("shared"));
    expect(sharedEntries).toHaveLength(1);
  });
});
