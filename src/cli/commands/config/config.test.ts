/**
 * Tests for config command
 *
 * These tests verify the configMain function behavior including:
 * - Interactive mode: calls flow, saves config on success
 * - Cancel: flow returns null, config is not saved
 * - Post-save prompts when installDir or defaultAgents change
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

import { loadConfig, saveConfig } from "@/cli/config.js";

// Mock os.homedir so getConfigPath resolves to test directories
vi.mock("os", async (importOriginal) => {
  const actual = await importOriginal<typeof os>();
  return {
    ...actual,
    homedir: vi.fn().mockReturnValue(actual.homedir()),
  };
});

// Mock clack prompts (outro is called in configMain after save)
vi.mock("@clack/prompts", () => ({
  outro: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), success: vi.fn() },
}));

// Mock the config flow
vi.mock("@/cli/prompts/flows/config.js", () => ({
  configFlow: vi.fn(),
}));

// Mock confirmAction
vi.mock("@/cli/prompts/confirm.js", () => ({
  confirmAction: vi.fn(),
}));

// Mock install main
vi.mock("@/cli/commands/install/install.js", () => ({
  main: vi.fn(),
}));

// Mock removeManagedFiles (still needed for some tests that import it directly)
vi.mock("@/cli/features/manifest.js", () => ({
  removeManagedFiles: vi.fn(),
  getManifestPath: vi
    .fn()
    .mockImplementation(
      (args: { agentName: string }) =>
        `/mock/.nori/manifests/${args.agentName}.json`,
    ),
  getLegacyManifestPath: vi
    .fn()
    .mockReturnValue("/mock/.nori/installed-manifest.json"),
}));

// Mock agentOperations - shared functions that replaced agent methods
vi.mock("@/cli/features/agentOperations.js", () => ({
  removeSkillset: vi.fn(),
  isInstalledAtDir: vi.fn().mockReturnValue(true),
}));

// Mock AgentRegistry - agent object is defined inline so vi.mock hoisting works
vi.mock("@/cli/features/agentRegistry.js", () => {
  const mockAgent = {
    name: "claude-code",
    displayName: "Claude Code",
    description: "Claude Code agent",
    getAgentDir: vi
      .fn()
      .mockImplementation(
        (args: { installDir: string }) => `${args.installDir}/.claude`,
      ),
    getSkillsDir: vi
      .fn()
      .mockImplementation(
        (args: { installDir: string }) => `${args.installDir}/.claude/skills`,
      ),
    getSubagentsDir: vi
      .fn()
      .mockImplementation(
        (args: { installDir: string }) => `${args.installDir}/.claude/agents`,
      ),
    getSlashcommandsDir: vi
      .fn()
      .mockImplementation(
        (args: { installDir: string }) => `${args.installDir}/.claude/commands`,
      ),
    getInstructionsFilePath: vi
      .fn()
      .mockImplementation(
        (args: { installDir: string }) =>
          `${args.installDir}/.claude/CLAUDE.md`,
      ),
    getLoaders: vi.fn().mockReturnValue([]),
  };
  return {
    AgentRegistry: {
      getInstance: vi.fn().mockReturnValue({
        list: vi.fn().mockReturnValue(["claude-code"]),
        getAll: vi.fn().mockReturnValue([mockAgent]),
        getDefaultAgentName: vi.fn().mockReturnValue("claude-code"),
        getAgentDirNames: vi.fn().mockReturnValue([".claude"]),
        get: vi.fn().mockReturnValue(mockAgent),
      }),
    },
  };
});

describe("configMain", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "config-cmd-test-"));
    vi.mocked(os.homedir).mockReturnValue(tempDir);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("should save defaultAgents and installDir to config when flow succeeds", async () => {
    const { configFlow } = await import("@/cli/prompts/flows/config.js");
    vi.mocked(configFlow).mockResolvedValueOnce({
      defaultAgents: ["claude-code"],
      installDir: tempDir,
      redownloadOnSwitch: "enabled",
    });

    // Create a minimal existing config so loadConfig returns something
    await saveConfig({
      username: null,
      organizationUrl: null,
      installDir: tempDir,
      activeSkillset: "senior-swe",
    });

    const { configMain } = await import("./config.js");
    await configMain();

    const loaded = await loadConfig();
    expect(loaded?.defaultAgents).toEqual(["claude-code"]);
    expect(loaded?.installDir).toBe(tempDir);
  });

  it("should not modify config when flow returns null (user cancelled)", async () => {
    const { configFlow } = await import("@/cli/prompts/flows/config.js");
    vi.mocked(configFlow).mockResolvedValueOnce(null);

    // Create an existing config
    await saveConfig({
      username: null,
      organizationUrl: null,
      installDir: tempDir,
      activeSkillset: "senior-swe",
    });

    const configBefore = await loadConfig();

    const { configMain } = await import("./config.js");
    await configMain();

    const configAfter = await loadConfig();
    expect(configAfter?.installDir).toBe(configBefore?.installDir);
  });

  it("should preserve existing config fields when saving", async () => {
    const { configFlow } = await import("@/cli/prompts/flows/config.js");
    vi.mocked(configFlow).mockResolvedValueOnce({
      defaultAgents: ["claude-code"],
      installDir: "/new/path",
      redownloadOnSwitch: "enabled",
    });

    // Create config with auth and agents
    await saveConfig({
      username: "test@example.com",
      refreshToken: "token-123",
      organizationUrl: "https://example.com",
      installDir: tempDir,
      activeSkillset: "senior-swe",
      sendSessionTranscript: "disabled",
    });

    const { configMain } = await import("./config.js");
    await configMain();

    const loaded = await loadConfig();
    expect(loaded?.auth?.username).toBe("test@example.com");
    expect(loaded?.activeSkillset).toBe("senior-swe");
    expect(loaded?.sendSessionTranscript).toBe("disabled");
    expect(loaded?.defaultAgents).toEqual(["claude-code"]);
    expect(loaded?.installDir).toBe("/new/path");
  });
});

describe("configMain return value and framing", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "config-cmd-test-"));
    vi.mocked(os.homedir).mockReturnValue(tempDir);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("should return CommandStatus with success on flow success", async () => {
    const { configFlow } = await import("@/cli/prompts/flows/config.js");
    vi.mocked(configFlow).mockResolvedValueOnce({
      defaultAgents: ["claude-code"],
      installDir: tempDir,
      redownloadOnSwitch: "enabled",
    });

    await saveConfig({
      username: null,
      organizationUrl: null,
      installDir: tempDir,
      activeSkillset: "senior-swe",
    });

    const { configMain } = await import("./config.js");
    const result = await configMain();

    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        cancelled: false,
        message: expect.any(String),
      }),
    );
  });

  it("should return CommandStatus with cancelled when flow returns null", async () => {
    const { configFlow } = await import("@/cli/prompts/flows/config.js");
    vi.mocked(configFlow).mockResolvedValueOnce(null);

    await saveConfig({
      username: null,
      organizationUrl: null,
      installDir: tempDir,
      activeSkillset: "senior-swe",
    });

    const { configMain } = await import("./config.js");
    const result = await configMain();

    expect(result).toEqual(
      expect.objectContaining({
        success: false,
        cancelled: true,
      }),
    );
  });
});

describe("configMain installDir change prompts", () => {
  let tempDir: string;
  let oldInstallDir: string;
  let newInstallDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "config-cmd-test-"));
    oldInstallDir = path.join(tempDir, "old");
    newInstallDir = path.join(tempDir, "new");
    await fs.mkdir(oldInstallDir, { recursive: true });
    await fs.mkdir(newInstallDir, { recursive: true });
    vi.mocked(os.homedir).mockReturnValue(tempDir);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("should prompt to install active skillset at new directory when installDir changes", async () => {
    const { configFlow } = await import("@/cli/prompts/flows/config.js");
    const { confirmAction } = await import("@/cli/prompts/confirm.js");
    const { main: installMain } =
      await import("@/cli/commands/install/install.js");

    vi.mocked(configFlow).mockResolvedValueOnce({
      defaultAgents: ["claude-code"],
      installDir: newInstallDir,
      redownloadOnSwitch: "enabled",
    });
    // First confirm: install to new dir? Yes. Second confirm: clean up old? No.
    vi.mocked(confirmAction)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    await saveConfig({
      username: null,
      organizationUrl: null,
      installDir: oldInstallDir,
      activeSkillset: "senior-swe",
    });

    const { configMain } = await import("./config.js");
    await configMain();

    expect(installMain).toHaveBeenCalledWith(
      expect.objectContaining({
        installDir: newInstallDir,
        silent: true,
      }),
    );
  });

  it("should prompt to clean up old directory when installDir changes", async () => {
    const { configFlow } = await import("@/cli/prompts/flows/config.js");
    const { confirmAction } = await import("@/cli/prompts/confirm.js");
    const { removeSkillset } =
      await import("@/cli/features/agentOperations.js");

    vi.mocked(configFlow).mockResolvedValueOnce({
      defaultAgents: ["claude-code"],
      installDir: newInstallDir,
      redownloadOnSwitch: "enabled",
    });
    // First confirm: install to new dir? No. Second confirm: clean up old? Yes.
    vi.mocked(confirmAction)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    await saveConfig({
      username: null,
      organizationUrl: null,
      installDir: oldInstallDir,
      activeSkillset: "senior-swe",
    });

    const { configMain } = await import("./config.js");
    await configMain();

    expect(vi.mocked(removeSkillset)).toHaveBeenCalledWith(
      expect.objectContaining({
        installDir: oldInstallDir,
      }),
    );
  });

  it("should clean up all agents installed at old directory, not just defaultAgents", async () => {
    const { configFlow } = await import("@/cli/prompts/flows/config.js");
    const { confirmAction } = await import("@/cli/prompts/confirm.js");
    const { AgentRegistry } = await import("@/cli/features/agentRegistry.js");
    const { removeSkillset } =
      await import("@/cli/features/agentOperations.js");

    // Set up a second agent (cursor-agent) that is installed at the old dir
    const mockCursorAgent = {
      name: "cursor-agent",
      displayName: "Cursor",
      description: "Cursor agent",
      getAgentDir: vi
        .fn()
        .mockImplementation(
          (args: { installDir: string }) => `${args.installDir}/.cursor`,
        ),
      getSkillsDir: vi
        .fn()
        .mockImplementation(
          (args: { installDir: string }) => `${args.installDir}/.cursor/skills`,
        ),
      getSubagentsDir: vi
        .fn()
        .mockImplementation(
          (args: { installDir: string }) => `${args.installDir}/.cursor/agents`,
        ),
      getSlashcommandsDir: vi
        .fn()
        .mockImplementation(
          (args: { installDir: string }) =>
            `${args.installDir}/.cursor/commands`,
        ),
      getInstructionsFilePath: vi
        .fn()
        .mockImplementation(
          (args: { installDir: string }) =>
            `${args.installDir}/.cursor/rules/nori.mdc`,
        ),
      getLoaders: vi.fn().mockReturnValue([]),
    };

    const registry = AgentRegistry.getInstance();
    const existingClaudeAgent = registry.get({ name: "claude-code" });

    // Make getAll return both agents
    vi.mocked(registry.getAll as any).mockReturnValue([
      existingClaudeAgent,
      mockCursorAgent,
    ]);

    vi.mocked(configFlow).mockResolvedValueOnce({
      defaultAgents: ["claude-code"],
      installDir: newInstallDir,
      redownloadOnSwitch: "enabled",
    });
    // First confirm: install to new dir? No. Second confirm: clean up old? Yes.
    vi.mocked(confirmAction)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    // Old config only has claude-code as defaultAgent
    await saveConfig({
      username: null,
      organizationUrl: null,
      installDir: oldInstallDir,
      activeSkillset: "senior-swe",
      defaultAgents: ["claude-code"],
    });

    const { configMain } = await import("./config.js");
    await configMain();

    // removeSkillset should have been called for both agents since both are installed
    expect(vi.mocked(removeSkillset)).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: existingClaudeAgent,
        installDir: oldInstallDir,
      }),
    );
    expect(vi.mocked(removeSkillset)).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: mockCursorAgent,
        installDir: oldInstallDir,
      }),
    );

    // Restore getAll to return only the original mock agent
    vi.mocked(registry.getAll as any).mockReturnValue([existingClaudeAgent]);
  });

  it("should not install or clean up when user declines both prompts", async () => {
    const { configFlow } = await import("@/cli/prompts/flows/config.js");
    const { confirmAction } = await import("@/cli/prompts/confirm.js");
    const { main: installMain } =
      await import("@/cli/commands/install/install.js");
    const { removeSkillset } =
      await import("@/cli/features/agentOperations.js");

    vi.mocked(configFlow).mockResolvedValueOnce({
      defaultAgents: ["claude-code"],
      installDir: newInstallDir,
      redownloadOnSwitch: "enabled",
    });
    vi.mocked(confirmAction)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false);

    await saveConfig({
      username: null,
      organizationUrl: null,
      installDir: oldInstallDir,
      activeSkillset: "senior-swe",
    });

    const { configMain } = await import("./config.js");
    await configMain();

    expect(installMain).not.toHaveBeenCalled();
    expect(vi.mocked(removeSkillset)).not.toHaveBeenCalled();
  });

  it("should skip all prompts when there is no active skillset", async () => {
    const { configFlow } = await import("@/cli/prompts/flows/config.js");
    const { confirmAction } = await import("@/cli/prompts/confirm.js");

    vi.mocked(configFlow).mockResolvedValueOnce({
      defaultAgents: ["claude-code"],
      installDir: newInstallDir,
      redownloadOnSwitch: "enabled",
    });

    await saveConfig({
      username: null,
      organizationUrl: null,
      installDir: oldInstallDir,
    });

    const { configMain } = await import("./config.js");
    await configMain();

    expect(confirmAction).not.toHaveBeenCalled();
  });

  it("should skip prompts when installDir and defaultAgents have not changed", async () => {
    const { configFlow } = await import("@/cli/prompts/flows/config.js");
    const { confirmAction } = await import("@/cli/prompts/confirm.js");

    vi.mocked(configFlow).mockResolvedValueOnce({
      defaultAgents: ["claude-code"],
      installDir: oldInstallDir,
      redownloadOnSwitch: "enabled",
    });

    await saveConfig({
      username: null,
      organizationUrl: null,
      installDir: oldInstallDir,
      activeSkillset: "senior-swe",
      defaultAgents: ["claude-code"],
    });

    const { configMain } = await import("./config.js");
    await configMain();

    expect(confirmAction).not.toHaveBeenCalled();
  });

  it("should call installMain once per agent when installDir changes and user confirms install", async () => {
    const { configFlow } = await import("@/cli/prompts/flows/config.js");
    const { confirmAction } = await import("@/cli/prompts/confirm.js");
    const { main: installMain } =
      await import("@/cli/commands/install/install.js");

    vi.mocked(configFlow).mockResolvedValueOnce({
      defaultAgents: ["claude-code", "agent-b"],
      installDir: newInstallDir,
      redownloadOnSwitch: "enabled",
    });
    // First confirm: install to new dir? Yes. Second confirm: clean up old? No.
    vi.mocked(confirmAction)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    await saveConfig({
      username: null,
      organizationUrl: null,
      installDir: oldInstallDir,
      activeSkillset: "senior-swe",
      defaultAgents: ["claude-code", "agent-b"],
    });

    const { configMain } = await import("./config.js");
    await configMain();

    // installMain should be called once per agent
    expect(installMain).toHaveBeenCalledTimes(2);
    expect(installMain).toHaveBeenCalledWith(
      expect.objectContaining({
        installDir: newInstallDir,
        agent: "claude-code",
        silent: true,
      }),
    );
    expect(installMain).toHaveBeenCalledWith(
      expect.objectContaining({
        installDir: newInstallDir,
        agent: "agent-b",
        silent: true,
      }),
    );
  });

  it("should clean up old directory before installing to new directory", async () => {
    const { configFlow } = await import("@/cli/prompts/flows/config.js");
    const { confirmAction } = await import("@/cli/prompts/confirm.js");
    const { main: installMain } =
      await import("@/cli/commands/install/install.js");
    const { removeSkillset } =
      await import("@/cli/features/agentOperations.js");

    vi.mocked(configFlow).mockResolvedValueOnce({
      defaultAgents: ["claude-code"],
      installDir: newInstallDir,
      redownloadOnSwitch: "enabled",
    });
    // Yes to both: install and clean up
    vi.mocked(confirmAction)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true);

    await saveConfig({
      username: null,
      organizationUrl: null,
      installDir: oldInstallDir,
      activeSkillset: "senior-swe",
    });

    // Track call order
    const callOrder: Array<string> = [];
    vi.mocked(removeSkillset).mockImplementation(async () => {
      callOrder.push("cleanup");
    });
    vi.mocked(installMain).mockImplementation(async () => {
      callOrder.push("install");
    });

    const { configMain } = await import("./config.js");
    await configMain();

    // cleanup is called once per agent, then install
    expect(callOrder).toEqual(["cleanup", "install"]);
  });
});

describe("configMain defaultAgents change prompts", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "config-cmd-test-"));
    vi.mocked(os.homedir).mockReturnValue(tempDir);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("should prompt to install when defaultAgents change", async () => {
    const { configFlow } = await import("@/cli/prompts/flows/config.js");
    const { confirmAction } = await import("@/cli/prompts/confirm.js");
    const { main: installMain } =
      await import("@/cli/commands/install/install.js");

    vi.mocked(configFlow).mockResolvedValueOnce({
      defaultAgents: ["claude-code", "new-agent"],
      installDir: tempDir,
      redownloadOnSwitch: "enabled",
    });
    vi.mocked(confirmAction).mockResolvedValueOnce(true);

    await saveConfig({
      username: null,
      organizationUrl: null,
      installDir: tempDir,
      activeSkillset: "senior-swe",
      defaultAgents: ["claude-code"],
    });

    const { configMain } = await import("./config.js");
    await configMain();

    expect(installMain).toHaveBeenCalledWith(
      expect.objectContaining({
        installDir: tempDir,
        silent: true,
      }),
    );
  });

  it("should call installMain once per added agent when defaultAgents grow", async () => {
    const { configFlow } = await import("@/cli/prompts/flows/config.js");
    const { confirmAction } = await import("@/cli/prompts/confirm.js");
    const { main: installMain } =
      await import("@/cli/commands/install/install.js");

    vi.mocked(configFlow).mockResolvedValueOnce({
      defaultAgents: ["claude-code", "agent-b", "agent-c"],
      installDir: tempDir,
      redownloadOnSwitch: "enabled",
    });
    vi.mocked(confirmAction).mockResolvedValueOnce(true);

    await saveConfig({
      username: null,
      organizationUrl: null,
      installDir: tempDir,
      activeSkillset: "senior-swe",
      defaultAgents: ["claude-code"],
    });

    const { configMain } = await import("./config.js");
    await configMain();

    // installMain should be called once per added agent (agent-b and agent-c)
    expect(installMain).toHaveBeenCalledTimes(2);
    expect(installMain).toHaveBeenCalledWith(
      expect.objectContaining({
        installDir: tempDir,
        agent: "agent-b",
        silent: true,
      }),
    );
    expect(installMain).toHaveBeenCalledWith(
      expect.objectContaining({
        installDir: tempDir,
        agent: "agent-c",
        silent: true,
      }),
    );
  });

  it("should not install when user declines agent change prompt", async () => {
    const { configFlow } = await import("@/cli/prompts/flows/config.js");
    const { confirmAction } = await import("@/cli/prompts/confirm.js");
    const { main: installMain } =
      await import("@/cli/commands/install/install.js");

    vi.mocked(configFlow).mockResolvedValueOnce({
      defaultAgents: ["new-agent"],
      installDir: tempDir,
      redownloadOnSwitch: "enabled",
    });
    vi.mocked(confirmAction).mockResolvedValueOnce(false);

    await saveConfig({
      username: null,
      organizationUrl: null,
      installDir: tempDir,
      activeSkillset: "senior-swe",
      defaultAgents: ["claude-code"],
    });

    const { configMain } = await import("./config.js");
    await configMain();

    expect(installMain).not.toHaveBeenCalled();
  });

  it("should prompt to clean up removed agents when defaultAgents shrinks", async () => {
    const { configFlow } = await import("@/cli/prompts/flows/config.js");
    const { confirmAction } = await import("@/cli/prompts/confirm.js");
    const { removeSkillset } =
      await import("@/cli/features/agentOperations.js");

    vi.mocked(configFlow).mockResolvedValueOnce({
      defaultAgents: [],
      installDir: tempDir,
      redownloadOnSwitch: "enabled",
    });
    // First confirm: clean up removed agents? Yes.
    vi.mocked(confirmAction).mockResolvedValueOnce(true);

    await saveConfig({
      username: null,
      organizationUrl: null,
      installDir: tempDir,
      activeSkillset: "senior-swe",
      defaultAgents: ["claude-code"],
    });

    const { configMain } = await import("./config.js");
    await configMain();

    expect(vi.mocked(removeSkillset)).toHaveBeenCalledWith(
      expect.objectContaining({
        installDir: tempDir,
      }),
    );
  });

  it("should not clean up removed agents when user declines", async () => {
    const { configFlow } = await import("@/cli/prompts/flows/config.js");
    const { confirmAction } = await import("@/cli/prompts/confirm.js");
    const { removeSkillset } =
      await import("@/cli/features/agentOperations.js");

    vi.mocked(configFlow).mockResolvedValueOnce({
      defaultAgents: [],
      installDir: tempDir,
      redownloadOnSwitch: "enabled",
    });
    // Decline all prompts
    vi.mocked(confirmAction).mockResolvedValue(false);

    await saveConfig({
      username: null,
      organizationUrl: null,
      installDir: tempDir,
      activeSkillset: "senior-swe",
      defaultAgents: ["claude-code"],
    });

    const { configMain } = await import("./config.js");
    await configMain();

    // A removal prompt should have been shown (message mentions "Remove")
    expect(confirmAction).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("Remove"),
      }),
    );
    expect(vi.mocked(removeSkillset)).not.toHaveBeenCalled();
  });
});
