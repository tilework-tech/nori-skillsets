/**
 * Tests for shared MCP loader.
 *
 * Verifies that createMcpLoader writes the correct files when a skillset
 * has an mcp/ directory containing canonical server entries. Tests assert
 * resulting filesystem state, not internal data.
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { createMcpLoader } from "@/cli/features/shared/mcpLoader.js";

import type { Config } from "@/cli/config.js";
import type { AgentConfig } from "@/cli/features/agentRegistry.js";
import type { Skillset } from "@/norijson/skillset.js";

// Suppress clack output during tests
vi.mock("@clack/prompts", () => ({
  log: { info: vi.fn(), warn: vi.fn(), success: vi.fn(), error: vi.fn() },
  note: vi.fn(),
}));

let mockHomeDir: string;
vi.mock("os", async (importOriginal) => {
  const actual = (await importOriginal()) as typeof os;
  return {
    ...actual,
    homedir: () => mockHomeDir,
    tmpdir: actual.tmpdir,
  };
});

const createTestAgent = (args: {
  name: AgentConfig["name"];
  agentDirName: string;
}): AgentConfig => {
  const { name, agentDirName } = args;
  return {
    name,
    displayName: name,
    description: "test agent",
    getAgentDir: ({ installDir }) => path.join(installDir, agentDirName),
    getSkillsDir: ({ installDir }) =>
      path.join(installDir, agentDirName, "skills"),
    getSubagentsDir: ({ installDir }) =>
      path.join(installDir, agentDirName, "agents"),
    getSlashcommandsDir: ({ installDir }) =>
      path.join(installDir, agentDirName, "commands"),
    getInstructionsFilePath: ({ installDir }) =>
      path.join(installDir, agentDirName, "AGENTS.md"),
    getLoaders: () => [],
  };
};

const createTestConfig = (args: { installDir: string }): Config => ({
  installDir: args.installDir,
  activeSkillset: "test-skillset",
});

const writeMcpServerFile = async (args: {
  mcpDir: string;
  fileName: string;
  body: Record<string, unknown>;
}): Promise<void> => {
  const { mcpDir, fileName, body } = args;
  await fs.mkdir(mcpDir, { recursive: true });
  await fs.writeFile(
    path.join(mcpDir, fileName),
    JSON.stringify(body, null, 2),
  );
};

const createTestSkillset = async (args: {
  skillsetsDir: string;
  name: string;
}): Promise<Skillset> => {
  const { skillsetsDir, name } = args;
  const skillsetDir = path.join(skillsetsDir, name);
  await fs.mkdir(skillsetDir, { recursive: true });
  await fs.writeFile(
    path.join(skillsetDir, "nori.json"),
    JSON.stringify({ name, version: "1.0.0" }),
  );
  return {
    name,
    dir: skillsetDir,
    metadata: { name, version: "1.0.0" },
    skillsDir: null,
    configFilePath: null,
    slashcommandsDir: null,
    subagentsDir: null,
    mcpDir: path.join(skillsetDir, "mcp"),
  };
};

describe("createMcpLoader — claude-mcp-json (project scope, whole-file)", () => {
  let tempDir: string;
  let installDir: string;
  let profilesDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-loader-test-"));
    mockHomeDir = tempDir;
    installDir = path.join(tempDir, "project");
    profilesDir = path.join(tempDir, ".nori", "profiles");
    await fs.mkdir(installDir, { recursive: true });
    await fs.mkdir(profilesDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("writes a canonical github stdio server to <installDir>/.mcp.json", async () => {
    const skillset = await createTestSkillset({
      skillsetsDir: profilesDir,
      name: "test-skillset",
    });
    await writeMcpServerFile({
      mcpDir: skillset.mcpDir!,
      fileName: "github.json",
      body: {
        name: "github",
        transport: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-github"],
        env: { GITHUB_TOKEN: "${env:GITHUB_TOKEN}" },
        scope: "project",
      },
    });

    const agent = createTestAgent({
      name: "claude-code",
      agentDirName: ".claude",
    });
    const loader = createMcpLoader({
      format: "claude-mcp-json",
      projectFile: ({ installDir: i }) => path.join(i, ".mcp.json"),
      projectMergeStrategy: "whole-file",
      userFile: () => path.join(mockHomeDir, ".claude.json"),
      userMergeStrategy: "merge-mcp-servers-key",
    });

    await loader.run({
      agent,
      config: createTestConfig({ installDir }),
      skillset,
    });

    const mcpJson = await fs.readFile(
      path.join(installDir, ".mcp.json"),
      "utf-8",
    );
    const parsed = JSON.parse(mcpJson);
    expect(parsed.mcpServers.github.command).toBe("npx");
    expect(parsed.mcpServers.github.env.GITHUB_TOKEN).toBe("${GITHUB_TOKEN}");
  });

  it("does not create the .mcp.json file when there are no servers for this agent", async () => {
    const skillset = await createTestSkillset({
      skillsetsDir: profilesDir,
      name: "test-skillset",
    });
    await writeMcpServerFile({
      mcpDir: skillset.mcpDir!,
      fileName: "vscode-only.json",
      body: {
        name: "vscode-only",
        transport: "stdio",
        command: "node",
        args: ["server.js"],
        worksWith: ["vscode"],
        scope: "project",
      },
    });

    const agent = createTestAgent({
      name: "claude-code",
      agentDirName: ".claude",
    });
    const loader = createMcpLoader({
      format: "claude-mcp-json",
      projectFile: ({ installDir: i }) => path.join(i, ".mcp.json"),
      projectMergeStrategy: "whole-file",
      userFile: () => path.join(mockHomeDir, ".claude.json"),
      userMergeStrategy: "merge-mcp-servers-key",
    });

    await loader.run({
      agent,
      config: createTestConfig({ installDir }),
      skillset,
    });

    const exists = await fs
      .access(path.join(installDir, ".mcp.json"))
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(false);
  });

  it("merges into existing user-scope ~/.claude.json without clobbering other keys", async () => {
    const skillset = await createTestSkillset({
      skillsetsDir: profilesDir,
      name: "test-skillset",
    });
    await writeMcpServerFile({
      mcpDir: skillset.mcpDir!,
      fileName: "linear.json",
      body: {
        name: "linear",
        transport: "http",
        url: "https://mcp.linear.app/sse",
        auth: "oauth",
        scope: "user",
      },
    });

    // Pre-existing ~/.claude.json with unrelated user state
    const userFile = path.join(mockHomeDir, ".claude.json");
    await fs.writeFile(
      userFile,
      JSON.stringify({
        someUnrelatedKey: "preserve-me",
        mcpServers: { existing: { command: "echo" } },
      }),
    );

    const agent = createTestAgent({
      name: "claude-code",
      agentDirName: ".claude",
    });
    const loader = createMcpLoader({
      format: "claude-mcp-json",
      projectFile: ({ installDir: i }) => path.join(i, ".mcp.json"),
      projectMergeStrategy: "whole-file",
      userFile: () => userFile,
      userMergeStrategy: "merge-mcp-servers-key",
    });

    await loader.run({
      agent,
      config: createTestConfig({ installDir }),
      skillset,
    });

    const merged = JSON.parse(await fs.readFile(userFile, "utf-8"));
    expect(merged.someUnrelatedKey).toBe("preserve-me");
    expect(merged.mcpServers.linear.url).toBe("https://mcp.linear.app/sse");
  });
});

describe("createMcpLoader — codex-toml scope handling", () => {
  let tempDir: string;
  let installDir: string;
  let profilesDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-codex-test-"));
    mockHomeDir = tempDir;
    installDir = path.join(tempDir, "project");
    profilesDir = path.join(tempDir, ".nori", "profiles");
    await fs.mkdir(installDir, { recursive: true });
    await fs.mkdir(profilesDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("writes project-scoped server to <installDir>/.codex/config.toml (Option B)", async () => {
    const skillset = await createTestSkillset({
      skillsetsDir: profilesDir,
      name: "test-skillset",
    });
    await writeMcpServerFile({
      mcpDir: skillset.mcpDir!,
      fileName: "github.json",
      body: {
        name: "github",
        transport: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-github"],
        scope: "project",
      },
    });

    const agent = createTestAgent({
      name: "codex",
      agentDirName: ".codex",
    });
    const loader = createMcpLoader({
      format: "codex-toml",
      projectFile: ({ installDir: i }) => path.join(i, ".codex", "config.toml"),
      projectMergeStrategy: "merge-toml-table",
      userFile: () => path.join(mockHomeDir, ".codex", "config.toml"),
      userMergeStrategy: "merge-toml-table",
    });

    await loader.run({
      agent,
      config: createTestConfig({ installDir }),
      skillset,
    });

    const projectFileContent = await fs.readFile(
      path.join(installDir, ".codex", "config.toml"),
      "utf-8",
    );
    expect(projectFileContent).toContain("[mcp_servers.github]");

    const userFileExists = await fs
      .access(path.join(mockHomeDir, ".codex", "config.toml"))
      .then(() => true)
      .catch(() => false);
    expect(userFileExists).toBe(false);
  });

  it("writes user-scoped server to ~/.codex/config.toml", async () => {
    const skillset = await createTestSkillset({
      skillsetsDir: profilesDir,
      name: "test-skillset",
    });
    await writeMcpServerFile({
      mcpDir: skillset.mcpDir!,
      fileName: "linear.json",
      body: {
        name: "linear",
        transport: "http",
        url: "https://mcp.linear.app/sse",
        auth: "oauth",
        scope: "user",
      },
    });

    const agent = createTestAgent({
      name: "codex",
      agentDirName: ".codex",
    });
    const loader = createMcpLoader({
      format: "codex-toml",
      projectFile: ({ installDir: i }) => path.join(i, ".codex", "config.toml"),
      projectMergeStrategy: "merge-toml-table",
      userFile: () => path.join(mockHomeDir, ".codex", "config.toml"),
      userMergeStrategy: "merge-toml-table",
    });

    await loader.run({
      agent,
      config: createTestConfig({ installDir }),
      skillset,
    });

    const userFileContent = await fs.readFile(
      path.join(mockHomeDir, ".codex", "config.toml"),
      "utf-8",
    );
    expect(userFileContent).toContain("[mcp_servers.linear]");
  });

  it("preserves unrelated [mcp_servers.other] tables when merging", async () => {
    const skillset = await createTestSkillset({
      skillsetsDir: profilesDir,
      name: "test-skillset",
    });
    await writeMcpServerFile({
      mcpDir: skillset.mcpDir!,
      fileName: "github.json",
      body: {
        name: "github",
        transport: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-github"],
        scope: "user",
      },
    });

    // Pre-existing user config with an unrelated server
    const userFile = path.join(mockHomeDir, ".codex", "config.toml");
    await fs.mkdir(path.dirname(userFile), { recursive: true });
    await fs.writeFile(
      userFile,
      [
        "[mcp_servers.user-managed]",
        'command = "node"',
        'args = ["custom-server.js"]',
        "",
      ].join("\n"),
    );

    const agent = createTestAgent({
      name: "codex",
      agentDirName: ".codex",
    });
    const loader = createMcpLoader({
      format: "codex-toml",
      projectFile: ({ installDir: i }) => path.join(i, ".codex", "config.toml"),
      projectMergeStrategy: "merge-toml-table",
      userFile: () => userFile,
      userMergeStrategy: "merge-toml-table",
    });

    await loader.run({
      agent,
      config: createTestConfig({ installDir }),
      skillset,
    });

    const merged = await fs.readFile(userFile, "utf-8");
    expect(merged).toContain("[mcp_servers.user-managed]");
    expect(merged).toContain("custom-server.js");
    expect(merged).toContain("[mcp_servers.github]");
  });
});

describe("createMcpLoader — gemini-json (merge into settings.json)", () => {
  let tempDir: string;
  let installDir: string;
  let profilesDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-gemini-test-"));
    mockHomeDir = tempDir;
    installDir = path.join(tempDir, "project");
    profilesDir = path.join(tempDir, ".nori", "profiles");
    await fs.mkdir(installDir, { recursive: true });
    await fs.mkdir(profilesDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("preserves a top-level theme key in settings.json while adding mcpServers.github", async () => {
    const skillset = await createTestSkillset({
      skillsetsDir: profilesDir,
      name: "test-skillset",
    });
    await writeMcpServerFile({
      mcpDir: skillset.mcpDir!,
      fileName: "github.json",
      body: {
        name: "github",
        transport: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-github"],
        env: { GITHUB_TOKEN: "${env:GITHUB_TOKEN}" },
        scope: "project",
      },
    });

    const settingsFile = path.join(installDir, ".gemini", "settings.json");
    await fs.mkdir(path.dirname(settingsFile), { recursive: true });
    await fs.writeFile(
      settingsFile,
      JSON.stringify({ theme: "dark", model: "gemini-pro" }),
    );

    const agent = createTestAgent({
      name: "gemini-cli",
      agentDirName: ".gemini",
    });
    const loader = createMcpLoader({
      format: "gemini-json",
      projectFile: ({ installDir: i }) =>
        path.join(i, ".gemini", "settings.json"),
      projectMergeStrategy: "merge-mcp-servers-key",
      userFile: () => path.join(mockHomeDir, ".gemini", "settings.json"),
      userMergeStrategy: "merge-mcp-servers-key",
    });

    await loader.run({
      agent,
      config: createTestConfig({ installDir }),
      skillset,
    });

    const merged = JSON.parse(await fs.readFile(settingsFile, "utf-8"));
    expect(merged.theme).toBe("dark");
    expect(merged.model).toBe("gemini-pro");
    expect(merged.mcpServers.github.command).toBe("npx");
  });
});

describe("createMcpLoader — worksWith filtering", () => {
  let tempDir: string;
  let installDir: string;
  let profilesDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-workswith-test-"));
    mockHomeDir = tempDir;
    installDir = path.join(tempDir, "project");
    profilesDir = path.join(tempDir, ".nori", "profiles");
    await fs.mkdir(installDir, { recursive: true });
    await fs.mkdir(profilesDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("includes a server when worksWith contains the agent name", async () => {
    const skillset = await createTestSkillset({
      skillsetsDir: profilesDir,
      name: "test-skillset",
    });
    await writeMcpServerFile({
      mcpDir: skillset.mcpDir!,
      fileName: "github.json",
      body: {
        name: "github",
        transport: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-github"],
        worksWith: ["claude-code", "codex"],
        scope: "project",
      },
    });

    const agent = createTestAgent({
      name: "claude-code",
      agentDirName: ".claude",
    });
    const loader = createMcpLoader({
      format: "claude-mcp-json",
      projectFile: ({ installDir: i }) => path.join(i, ".mcp.json"),
      projectMergeStrategy: "whole-file",
      userFile: () => path.join(mockHomeDir, ".claude.json"),
      userMergeStrategy: "merge-mcp-servers-key",
    });

    await loader.run({
      agent,
      config: createTestConfig({ installDir }),
      skillset,
    });

    const parsed = JSON.parse(
      await fs.readFile(path.join(installDir, ".mcp.json"), "utf-8"),
    );
    expect(parsed.mcpServers.github.command).toBe("npx");
    expect(parsed.mcpServers.github.args).toEqual([
      "-y",
      "@modelcontextprotocol/server-github",
    ]);
  });

  it("omits a server when worksWith does not include the agent name", async () => {
    const skillset = await createTestSkillset({
      skillsetsDir: profilesDir,
      name: "test-skillset",
    });
    await writeMcpServerFile({
      mcpDir: skillset.mcpDir!,
      fileName: "codex-only.json",
      body: {
        name: "codex-only",
        transport: "stdio",
        command: "echo",
        args: [],
        worksWith: ["codex"],
        scope: "project",
      },
    });

    const agent = createTestAgent({
      name: "claude-code",
      agentDirName: ".claude",
    });
    const loader = createMcpLoader({
      format: "claude-mcp-json",
      projectFile: ({ installDir: i }) => path.join(i, ".mcp.json"),
      projectMergeStrategy: "whole-file",
      userFile: () => path.join(mockHomeDir, ".claude.json"),
      userMergeStrategy: "merge-mcp-servers-key",
    });

    await loader.run({
      agent,
      config: createTestConfig({ installDir }),
      skillset,
    });

    const exists = await fs
      .access(path.join(installDir, ".mcp.json"))
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(false);
  });
});

describe("createMcpLoader — missing mcp directory", () => {
  let tempDir: string;
  let installDir: string;
  let profilesDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-missing-test-"));
    mockHomeDir = tempDir;
    installDir = path.join(tempDir, "project");
    profilesDir = path.join(tempDir, ".nori", "profiles");
    await fs.mkdir(installDir, { recursive: true });
    await fs.mkdir(profilesDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("does not throw and writes nothing when the skillset has no mcp directory", async () => {
    const skillsetDir = path.join(profilesDir, "no-mcp-skillset");
    await fs.mkdir(skillsetDir, { recursive: true });
    await fs.writeFile(
      path.join(skillsetDir, "nori.json"),
      JSON.stringify({ name: "no-mcp-skillset", version: "1.0.0" }),
    );

    const skillset: Skillset = {
      name: "no-mcp-skillset",
      dir: skillsetDir,
      metadata: { name: "no-mcp-skillset", version: "1.0.0" },
      skillsDir: null,
      configFilePath: null,
      slashcommandsDir: null,
      subagentsDir: null,
      mcpDir: null,
    };

    const agent = createTestAgent({
      name: "claude-code",
      agentDirName: ".claude",
    });
    const loader = createMcpLoader({
      format: "claude-mcp-json",
      projectFile: ({ installDir: i }) => path.join(i, ".mcp.json"),
      projectMergeStrategy: "whole-file",
      userFile: () => path.join(mockHomeDir, ".claude.json"),
      userMergeStrategy: "merge-mcp-servers-key",
    });

    await expect(
      loader.run({
        agent,
        config: createTestConfig({ installDir }),
        skillset,
      }),
    ).resolves.not.toThrow();

    const exists = await fs
      .access(path.join(installDir, ".mcp.json"))
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(false);
  });
});
