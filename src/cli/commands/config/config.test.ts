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

// Mock AgentRegistry
vi.mock("@/cli/features/agentRegistry.js", () => ({
  AgentRegistry: {
    getInstance: vi.fn().mockReturnValue({
      list: vi.fn().mockReturnValue(["claude-code"]),
      getDefaultAgentName: vi.fn().mockReturnValue("claude-code"),
      get: vi.fn().mockReturnValue({
        name: "claude-code",
        displayName: "Claude Code",
        getAgentDir: vi
          .fn()
          .mockImplementation(
            (args: { installDir: string }) => `${args.installDir}/.claude`,
          ),
        getManagedFiles: vi
          .fn()
          .mockReturnValue([
            "CLAUDE.md",
            "settings.json",
            "nori-statusline.sh",
          ]),
        getManagedDirs: vi
          .fn()
          .mockReturnValue(["skills", "commands", "agents"]),
        removeSkillset: vi.fn(),
        installSkillset: vi.fn(),
        detectLocalChanges: vi.fn().mockResolvedValue(null),
      }),
    }),
  },
}));

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
    const { AgentRegistry } = await import("@/cli/features/agentRegistry.js");

    vi.mocked(configFlow).mockResolvedValueOnce({
      defaultAgents: ["claude-code"],
      installDir: newInstallDir,
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

    const mockAgent = AgentRegistry.getInstance().get({ name: "claude-code" });
    expect(mockAgent.removeSkillset).toHaveBeenCalledWith({
      installDir: oldInstallDir,
    });
  });

  it("should not install or clean up when user declines both prompts", async () => {
    const { configFlow } = await import("@/cli/prompts/flows/config.js");
    const { confirmAction } = await import("@/cli/prompts/confirm.js");
    const { main: installMain } =
      await import("@/cli/commands/install/install.js");
    const { AgentRegistry } = await import("@/cli/features/agentRegistry.js");

    vi.mocked(configFlow).mockResolvedValueOnce({
      defaultAgents: ["claude-code"],
      installDir: newInstallDir,
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

    const mockAgent = AgentRegistry.getInstance().get({ name: "claude-code" });
    expect(installMain).not.toHaveBeenCalled();
    expect(mockAgent.removeSkillset).not.toHaveBeenCalled();
  });

  it("should skip all prompts when there is no active skillset", async () => {
    const { configFlow } = await import("@/cli/prompts/flows/config.js");
    const { confirmAction } = await import("@/cli/prompts/confirm.js");

    vi.mocked(configFlow).mockResolvedValueOnce({
      defaultAgents: ["claude-code"],
      installDir: newInstallDir,
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

  it("should clean up old directory before installing to new directory", async () => {
    const { configFlow } = await import("@/cli/prompts/flows/config.js");
    const { confirmAction } = await import("@/cli/prompts/confirm.js");
    const { main: installMain } =
      await import("@/cli/commands/install/install.js");
    const { AgentRegistry } = await import("@/cli/features/agentRegistry.js");

    vi.mocked(configFlow).mockResolvedValueOnce({
      defaultAgents: ["claude-code"],
      installDir: newInstallDir,
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
    const mockAgent = AgentRegistry.getInstance().get({ name: "claude-code" });
    vi.mocked(mockAgent.removeSkillset).mockImplementation(async () => {
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

  it("should not install when user declines agent change prompt", async () => {
    const { configFlow } = await import("@/cli/prompts/flows/config.js");
    const { confirmAction } = await import("@/cli/prompts/confirm.js");
    const { main: installMain } =
      await import("@/cli/commands/install/install.js");

    vi.mocked(configFlow).mockResolvedValueOnce({
      defaultAgents: ["new-agent"],
      installDir: tempDir,
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
});
