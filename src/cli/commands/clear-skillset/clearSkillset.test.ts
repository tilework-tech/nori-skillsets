/**
 * Tests for clear-skillset command
 * Tests that the CLI correctly clears the agent's profile and runs uninstall
 */

import * as fs from "fs/promises";
import { tmpdir } from "os";
import * as path from "path";

import { Command } from "commander";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { AgentRegistry } from "@/cli/features/agentRegistry.js";

import {
  clearSkillsetMain,
  registerClearSkillsetCommand,
} from "./clearSkillset.js";

// Hoist mock references so vi.mock factory can access them
const { mockRunUninstall, mockPromptUser } = vi.hoisted(() => ({
  mockRunUninstall: vi.fn().mockResolvedValue(undefined),
  mockPromptUser: vi.fn(),
}));

vi.mock("@/cli/commands/uninstall/uninstall.js", () => ({
  runUninstall: mockRunUninstall,
}));

vi.mock("@/cli/prompt.js", () => ({
  promptUser: mockPromptUser,
}));

describe("agent.clearProfile", () => {
  let testInstallDir: string;

  beforeEach(async () => {
    testInstallDir = await fs.mkdtemp(
      path.join(tmpdir(), "clear-profile-test-"),
    );
    const testClaudeDir = path.join(testInstallDir, ".claude");
    const testNoriDir = path.join(testInstallDir, ".nori");
    await fs.mkdir(testClaudeDir, { recursive: true });
    await fs.mkdir(testNoriDir, { recursive: true });
    AgentRegistry.resetInstance();
  });

  afterEach(async () => {
    if (testInstallDir) {
      await fs.rm(testInstallDir, { recursive: true, force: true });
    }
    AgentRegistry.resetInstance();
  });

  it("should set profile to null in config for claude-code", async () => {
    // Create config with existing profile
    const configPath = path.join(testInstallDir, ".nori-config.json");
    const initialConfig = {
      agents: {
        "claude-code": { profile: { baseProfile: "senior-swe" } },
      },
      version: "v19.0.0",
    };
    await fs.writeFile(configPath, JSON.stringify(initialConfig, null, 2));

    const agent = AgentRegistry.getInstance().get({ name: "claude-code" });
    await agent.clearProfile({ installDir: testInstallDir });

    const updatedConfig = JSON.parse(await fs.readFile(configPath, "utf-8"));
    expect(updatedConfig.agents?.["claude-code"]?.profile).toBeNull();
  });

  it("should preserve auth credentials when clearing profile", async () => {
    const configPath = path.join(testInstallDir, ".nori-config.json");
    const initialConfig = {
      agents: {
        "claude-code": { profile: { baseProfile: "senior-swe" } },
      },
      auth: {
        username: "test@example.com",
        refreshToken: "test-refresh-token-12345",
        organizationUrl: "https://org.example.com",
      },
      version: "v19.0.0",
    };
    await fs.writeFile(configPath, JSON.stringify(initialConfig, null, 2));

    const agent = AgentRegistry.getInstance().get({ name: "claude-code" });
    await agent.clearProfile({ installDir: testInstallDir });

    const updatedConfig = JSON.parse(await fs.readFile(configPath, "utf-8"));
    expect(updatedConfig.auth?.refreshToken).toBe("test-refresh-token-12345");
    expect(updatedConfig.auth?.username).toBe("test@example.com");
    expect(updatedConfig.auth?.organizationUrl).toBe("https://org.example.com");
  });

  it("should preserve version when clearing profile", async () => {
    const configPath = path.join(testInstallDir, ".nori-config.json");
    const initialConfig = {
      agents: {
        "claude-code": { profile: { baseProfile: "senior-swe" } },
      },
      version: "v19.0.0",
    };
    await fs.writeFile(configPath, JSON.stringify(initialConfig, null, 2));

    const agent = AgentRegistry.getInstance().get({ name: "claude-code" });
    await agent.clearProfile({ installDir: testInstallDir });

    const updatedConfig = JSON.parse(await fs.readFile(configPath, "utf-8"));
    expect(updatedConfig.version).toBe("v19.0.0");
  });

  it("should set profile to null in config for cursor-agent", async () => {
    const configPath = path.join(testInstallDir, ".nori-config.json");
    const initialConfig = {
      agents: {
        "cursor-agent": { profile: { baseProfile: "senior-swe" } },
      },
      version: "v19.0.0",
    };
    await fs.writeFile(configPath, JSON.stringify(initialConfig, null, 2));

    const agent = AgentRegistry.getInstance().get({ name: "cursor-agent" });
    await agent.clearProfile({ installDir: testInstallDir });

    const updatedConfig = JSON.parse(await fs.readFile(configPath, "utf-8"));
    expect(updatedConfig.agents?.["cursor-agent"]?.profile).toBeNull();
  });

  it("should succeed even when no profile is currently set", async () => {
    const configPath = path.join(testInstallDir, ".nori-config.json");
    const initialConfig = {
      agents: {
        "claude-code": {},
      },
      version: "v19.0.0",
    };
    await fs.writeFile(configPath, JSON.stringify(initialConfig, null, 2));

    const agent = AgentRegistry.getInstance().get({ name: "claude-code" });
    // Should not throw
    await agent.clearProfile({ installDir: testInstallDir });

    const updatedConfig = JSON.parse(await fs.readFile(configPath, "utf-8"));
    expect(updatedConfig.agents?.["claude-code"]?.profile).toBeNull();
  });
});

describe("clearSkillsetMain", () => {
  let testInstallDir: string;

  beforeEach(async () => {
    testInstallDir = await fs.mkdtemp(
      path.join(tmpdir(), "clear-skillset-main-test-"),
    );
    const testClaudeDir = path.join(testInstallDir, ".claude");
    const testNoriDir = path.join(testInstallDir, ".nori");
    await fs.mkdir(testClaudeDir, { recursive: true });
    await fs.mkdir(testNoriDir, { recursive: true });
    AgentRegistry.resetInstance();
    mockRunUninstall.mockClear();
    mockPromptUser.mockReset();
  });

  afterEach(async () => {
    if (testInstallDir) {
      await fs.rm(testInstallDir, { recursive: true, force: true });
    }
    AgentRegistry.resetInstance();
    vi.restoreAllMocks();
  });

  it("should call runUninstall with removeConfig=false and removeGlobalSettings=false", async () => {
    const configPath = path.join(testInstallDir, ".nori-config.json");
    await fs.writeFile(
      configPath,
      JSON.stringify({
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      }),
    );

    // Mock clearProfile on the agent
    const agent = AgentRegistry.getInstance().get({ name: "claude-code" });
    vi.spyOn(agent, "clearProfile").mockResolvedValue(undefined);

    await clearSkillsetMain({
      installDir: testInstallDir,
      nonInteractive: true,
      agent: "claude-code",
    });

    expect(mockRunUninstall).toHaveBeenCalledWith(
      expect.objectContaining({
        removeConfig: false,
        removeGlobalSettings: false,
        installDir: testInstallDir,
        agent: "claude-code",
      }),
    );
  });

  it("should call agent.clearProfile before running uninstall", async () => {
    const configPath = path.join(testInstallDir, ".nori-config.json");
    await fs.writeFile(
      configPath,
      JSON.stringify({
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      }),
    );

    const callOrder: Array<string> = [];
    const agent = AgentRegistry.getInstance().get({ name: "claude-code" });
    vi.spyOn(agent, "clearProfile").mockImplementation(async () => {
      callOrder.push("clearProfile");
    });
    mockRunUninstall.mockImplementation(async () => {
      callOrder.push("runUninstall");
    });

    await clearSkillsetMain({
      installDir: testInstallDir,
      nonInteractive: true,
      agent: "claude-code",
    });

    expect(callOrder).toEqual(["clearProfile", "runUninstall"]);
  });

  it("should skip confirmation in non-interactive mode", async () => {
    const configPath = path.join(testInstallDir, ".nori-config.json");
    await fs.writeFile(
      configPath,
      JSON.stringify({
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      }),
    );

    const agent = AgentRegistry.getInstance().get({ name: "claude-code" });
    vi.spyOn(agent, "clearProfile").mockResolvedValue(undefined);

    await clearSkillsetMain({
      installDir: testInstallDir,
      nonInteractive: true,
      agent: "claude-code",
    });

    expect(mockPromptUser).not.toHaveBeenCalled();
  });

  it("should cancel when user declines confirmation in interactive mode", async () => {
    const configPath = path.join(testInstallDir, ".nori-config.json");
    await fs.writeFile(
      configPath,
      JSON.stringify({
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      }),
    );

    mockPromptUser.mockResolvedValueOnce("n");

    const agent = AgentRegistry.getInstance().get({ name: "claude-code" });
    const clearSpy = vi
      .spyOn(agent, "clearProfile")
      .mockResolvedValue(undefined);

    await clearSkillsetMain({
      installDir: testInstallDir,
      nonInteractive: false,
      agent: "claude-code",
    });

    expect(clearSpy).not.toHaveBeenCalled();
    expect(mockRunUninstall).not.toHaveBeenCalled();
  });

  it("should proceed when user confirms in interactive mode", async () => {
    const configPath = path.join(testInstallDir, ".nori-config.json");
    await fs.writeFile(
      configPath,
      JSON.stringify({
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      }),
    );

    mockPromptUser.mockResolvedValueOnce("y");

    const agent = AgentRegistry.getInstance().get({ name: "claude-code" });
    const clearSpy = vi
      .spyOn(agent, "clearProfile")
      .mockResolvedValue(undefined);

    await clearSkillsetMain({
      installDir: testInstallDir,
      nonInteractive: false,
      agent: "claude-code",
    });

    expect(clearSpy).toHaveBeenCalled();
    expect(mockRunUninstall).toHaveBeenCalled();
  });
});

describe("registerClearSkillsetCommand", () => {
  let testInstallDir: string;

  beforeEach(async () => {
    testInstallDir = await fs.mkdtemp(
      path.join(tmpdir(), "clear-skillset-cmd-test-"),
    );
    const testClaudeDir = path.join(testInstallDir, ".claude");
    const testNoriDir = path.join(testInstallDir, ".nori");
    await fs.mkdir(testClaudeDir, { recursive: true });
    await fs.mkdir(testNoriDir, { recursive: true });
    AgentRegistry.resetInstance();
    mockRunUninstall.mockClear();
    mockPromptUser.mockReset();
  });

  afterEach(async () => {
    if (testInstallDir) {
      await fs.rm(testInstallDir, { recursive: true, force: true });
    }
    AgentRegistry.resetInstance();
    vi.restoreAllMocks();
  });

  it("should accept --agent as a local option", async () => {
    const configPath = path.join(testInstallDir, ".nori-config.json");
    await fs.writeFile(
      configPath,
      JSON.stringify({
        agents: {
          "cursor-agent": { profile: { baseProfile: "senior-swe" } },
        },
      }),
    );

    const program = new Command();
    program.exitOverride();
    program.configureOutput({ writeErr: () => undefined });
    program
      .option("-d, --install-dir <path>", "Custom installation directory")
      .option("-n, --non-interactive", "Run without interactive prompts")
      .option(
        "-a, --agent <name>",
        "AI agent to use (auto-detected from config, or claude-code)",
      );

    registerClearSkillsetCommand({ program });

    const cursorAgent = AgentRegistry.getInstance().get({
      name: "cursor-agent",
    });
    const clearSpy = vi
      .spyOn(cursorAgent, "clearProfile")
      .mockResolvedValue(undefined);

    let parseError: Error | null = null;
    try {
      await program.parseAsync([
        "node",
        "nori-ai",
        "clear-skillset",
        "--agent",
        "cursor-agent",
        "--install-dir",
        testInstallDir,
        "--non-interactive",
      ]);
    } catch (err) {
      parseError = err as Error;
    }

    if (parseError != null) {
      expect(parseError.message).not.toContain("unknown option");
    }

    expect(clearSpy).toHaveBeenCalledWith({
      installDir: testInstallDir,
    });
  });

  it("should auto-select the only installed agent when --agent not provided", async () => {
    const configPath = path.join(testInstallDir, ".nori-config.json");
    await fs.writeFile(
      configPath,
      JSON.stringify({
        agents: {
          "cursor-agent": { profile: { baseProfile: "senior-swe" } },
        },
      }),
    );

    const program = new Command();
    program.exitOverride();
    program.configureOutput({ writeErr: () => undefined });
    program
      .option("-d, --install-dir <path>", "Custom installation directory")
      .option("-n, --non-interactive", "Run without interactive prompts")
      .option("-a, --agent <name>", "AI agent to use");

    registerClearSkillsetCommand({ program });

    const cursorAgent = AgentRegistry.getInstance().get({
      name: "cursor-agent",
    });
    const clearSpy = vi
      .spyOn(cursorAgent, "clearProfile")
      .mockResolvedValue(undefined);

    try {
      await program.parseAsync([
        "node",
        "nori-ai",
        "--non-interactive",
        "clear-skillset",
        "--install-dir",
        testInstallDir,
      ]);
    } catch {
      // May throw due to exit
    }

    expect(clearSpy).toHaveBeenCalledWith({
      installDir: testInstallDir,
    });
  });

  it("should error in non-interactive mode when multiple agents installed and no --agent", async () => {
    const configPath = path.join(testInstallDir, ".nori-config.json");
    await fs.writeFile(
      configPath,
      JSON.stringify({
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
          "cursor-agent": { profile: { baseProfile: "senior-swe" } },
        },
      }),
    );

    const program = new Command();
    program.exitOverride();
    let errorMessage = "";
    program.configureOutput({
      writeErr: (str) => {
        errorMessage += str;
      },
    });
    program
      .option("-d, --install-dir <path>", "Custom installation directory")
      .option("-n, --non-interactive", "Run without interactive prompts")
      .option("-a, --agent <name>", "AI agent to use");

    registerClearSkillsetCommand({ program });

    let thrownError: Error | null = null;
    try {
      await program.parseAsync([
        "node",
        "nori-ai",
        "--non-interactive",
        "clear-skillset",
        "--install-dir",
        testInstallDir,
      ]);
    } catch (err) {
      thrownError = err as Error;
    }

    expect(thrownError).not.toBeNull();
    expect(
      errorMessage.includes("--agent") ||
        thrownError?.message.includes("agent"),
    ).toBe(true);
  });
});

describe("clear-skillset auto-detection", () => {
  let testInstallDir: string;
  let originalCwd: string;

  beforeEach(async () => {
    originalCwd = process.cwd();
    testInstallDir = await fs.realpath(
      await fs.mkdtemp(path.join(tmpdir(), "clear-skillset-autodetect-test-")),
    );

    const noriDir = path.join(testInstallDir, ".nori");
    await fs.mkdir(noriDir, { recursive: true });

    const configPath = path.join(testInstallDir, ".nori-config.json");
    await fs.writeFile(
      configPath,
      JSON.stringify({
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      }),
    );

    AgentRegistry.resetInstance();
    mockRunUninstall.mockClear();
    mockPromptUser.mockReset();
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    if (testInstallDir) {
      await fs.rm(testInstallDir, { recursive: true, force: true });
    }
    AgentRegistry.resetInstance();
    vi.restoreAllMocks();
  });

  it("should auto-detect installation in current directory when no --install-dir provided", async () => {
    process.chdir(testInstallDir);

    const program = new Command();
    program.exitOverride();
    program.configureOutput({ writeErr: () => undefined });
    program
      .option("-d, --install-dir <path>", "Custom installation directory")
      .option("-n, --non-interactive", "Run without interactive prompts")
      .option("-a, --agent <name>", "AI agent to use");

    registerClearSkillsetCommand({ program });

    const claudeAgent = AgentRegistry.getInstance().get({
      name: "claude-code",
    });
    const clearSpy = vi
      .spyOn(claudeAgent, "clearProfile")
      .mockResolvedValue(undefined);

    try {
      await program.parseAsync([
        "node",
        "nori-ai",
        "--non-interactive",
        "clear-skillset",
      ]);
    } catch {
      // May throw due to exit
    }

    expect(clearSpy).toHaveBeenCalledWith({
      installDir: testInstallDir,
    });
  });

  it("should error when no installation found", async () => {
    const emptyDir = await fs.mkdtemp(
      path.join(tmpdir(), "clear-skillset-empty-test-"),
    );

    try {
      process.chdir(emptyDir);

      const program = new Command();
      program.exitOverride();
      let errorOutput = "";
      program.configureOutput({
        writeErr: (str) => {
          errorOutput += str;
        },
      });
      program
        .option("-d, --install-dir <path>", "Custom installation directory")
        .option("-n, --non-interactive", "Run without interactive prompts")
        .option("-a, --agent <name>", "AI agent to use");

      registerClearSkillsetCommand({ program });

      let thrownError: Error | null = null;
      try {
        await program.parseAsync([
          "node",
          "nori-ai",
          "--non-interactive",
          "clear-skillset",
        ]);
      } catch (err) {
        thrownError = err as Error;
      }

      expect(thrownError).not.toBeNull();
      expect(
        errorOutput.toLowerCase().includes("no") ||
          thrownError?.message.toLowerCase().includes("no") ||
          errorOutput.toLowerCase().includes("not found") ||
          thrownError?.message.toLowerCase().includes("not found"),
      ).toBe(true);
    } finally {
      await fs.rm(emptyDir, { recursive: true, force: true });
    }
  });
});
