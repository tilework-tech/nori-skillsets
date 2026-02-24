/**
 * Tests for switch-skillset command
 * Tests that the CLI correctly delegates to agent methods
 */

import * as fs from "fs/promises";
import * as os from "os";
import { tmpdir } from "os";
import * as path from "path";

import { Command } from "commander";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { AgentRegistry } from "@/cli/features/agentRegistry.js";

import { registerSwitchSkillsetCommand } from "./switchSkillset.js";

// Mock os.homedir so getNoriDir/getNoriSkillsetsDir resolve to the test directory
vi.mock("os", async (importOriginal) => {
  const actual = await importOriginal<typeof os>();
  return {
    ...actual,
    homedir: vi.fn().mockReturnValue(actual.homedir()),
  };
});

// Mock install to avoid side effects - track calls for verification
const mockInstallMain = vi.fn().mockResolvedValue(undefined);
vi.mock("@/cli/commands/install/install.js", () => ({
  main: mockInstallMain,
}));

// Mock switchSkillsetFlow for interactive UI tests
const mockSwitchSkillsetFlow = vi.fn();
vi.mock("@/cli/prompts/flows/switchSkillset.js", () => ({
  switchSkillsetFlow: (...args: Array<unknown>) =>
    mockSwitchSkillsetFlow(...args),
}));

// Mock listSkillsets for interactive selection tests
const mockListSkillsets = vi.fn();
vi.mock("@/cli/features/managedFolder.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    listSkillsets: (...args: Array<unknown>) => mockListSkillsets(...args),
  };
});

// Mock @clack/prompts for interactive selection tests
const mockSelect = vi.fn();
vi.mock("@clack/prompts", () => ({
  select: (...args: Array<unknown>) => mockSelect(...args),
  log: {
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    message: vi.fn(),
  },
  isCancel: vi.fn(() => false),
  cancel: vi.fn(),
}));

describe("agent.switchSkillset", () => {
  let testInstallDir: string;

  beforeEach(async () => {
    testInstallDir = await fs.mkdtemp(path.join(tmpdir(), "switch-test-"));
    vi.mocked(os.homedir).mockReturnValue(testInstallDir);
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
    vi.restoreAllMocks();
  });

  it("should not modify config on disk when switching skillsets for claude-code", async () => {
    // Create skillsets directory with test skillsets
    const skillsetsDir = path.join(testInstallDir, ".nori", "profiles");
    await fs.mkdir(skillsetsDir, { recursive: true });

    for (const name of ["profile-a", "profile-b"]) {
      const dir = path.join(skillsetsDir, name);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(
        path.join(dir, "nori.json"),
        JSON.stringify({ name, version: "1.0.0" }),
      );
    }

    // Create initial config with version and auth
    const configPath = path.join(testInstallDir, ".nori-config.json");
    const initialConfig = {
      activeSkillset: "profile-a",
      version: "v19.0.0",
      auth: {
        username: "test@example.com",
        refreshToken: "test-refresh-token-12345",
        organizationUrl: "https://org.example.com",
      },
    };
    await fs.writeFile(configPath, JSON.stringify(initialConfig, null, 2));

    const configBefore = await fs.readFile(configPath, "utf-8");

    // Switch to profile-b using agent method
    const agent = AgentRegistry.getInstance().get({ name: "claude-code" });
    await agent.switchSkillset({
      installDir: testInstallDir,
      skillsetName: "profile-b",
    });

    // Config on disk should be completely unchanged — the agent layer
    // no longer owns config persistence
    const configAfter = await fs.readFile(configPath, "utf-8");
    expect(configAfter).toBe(configBefore);
  });
});

describe("registerSwitchSkillsetCommand", () => {
  let testInstallDir: string;

  beforeEach(async () => {
    testInstallDir = await fs.mkdtemp(
      path.join(tmpdir(), "switch-skillset-cmd-test-"),
    );
    vi.mocked(os.homedir).mockReturnValue(testInstallDir);
    const testClaudeDir = path.join(testInstallDir, ".claude");
    const testNoriDir = path.join(testInstallDir, ".nori");
    await fs.mkdir(testClaudeDir, { recursive: true });
    await fs.mkdir(testNoriDir, { recursive: true });

    // Create skillsets directory with test skillsets
    const skillsetsDir = path.join(testNoriDir, "profiles");
    await fs.mkdir(skillsetsDir, { recursive: true });
    for (const name of ["senior-swe", "product-manager"]) {
      const dir = path.join(skillsetsDir, name);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(
        path.join(dir, "nori.json"),
        JSON.stringify({ name, version: "1.0.0" }),
      );
    }

    AgentRegistry.resetInstance();
    mockSwitchSkillsetFlow.mockReset();
  });

  afterEach(async () => {
    if (testInstallDir) {
      await fs.rm(testInstallDir, { recursive: true, force: true });
    }
    AgentRegistry.resetInstance();
    vi.restoreAllMocks();
  });

  it("should accept --agent as a local option after the subcommand", async () => {
    // Create a program and register the command
    const program = new Command();
    program.exitOverride(); // Throw instead of process.exit
    program.configureOutput({
      writeErr: () => undefined, // Suppress error output
    });

    // Add global options like the real CLI
    program
      .option("-d, --install-dir <path>", "Custom installation directory")
      .option("-n, --non-interactive", "Run without interactive prompts")
      .option("-a, --agent <name>", "AI agent to use", "claude-code");

    registerSwitchSkillsetCommand({ program });

    // This should NOT throw "unknown option '--agent'" when --agent comes after the subcommand
    // Parse with --agent AFTER the subcommand (the bug case)
    let parseError: Error | null = null;
    try {
      await program.parseAsync([
        "node",
        "nori-skillsets",
        "switch-skillset",
        "senior-swe",
        "--agent",
        "claude-code",
        "--install-dir",
        testInstallDir,
      ]);
    } catch (err) {
      parseError = err as Error;
    }

    // The command should accept --agent after the subcommand
    // If it throws "unknown option '--agent'", the test fails
    // If parseError is undefined (no error), the test passes
    if (parseError != null) {
      expect(parseError.message).not.toContain("unknown option");
    }
  });

  it("should call installMain with silent: true in non-interactive mode", async () => {
    // Create config with claude-code installed
    const configPath = path.join(testInstallDir, ".nori-config.json");
    await fs.writeFile(
      configPath,
      JSON.stringify({
        activeSkillset: "senior-swe",
        installDir: testInstallDir,
      }),
    );

    const program = new Command();
    program.exitOverride();
    program.configureOutput({ writeErr: () => undefined });
    program
      .option("-d, --install-dir <path>", "Custom installation directory")
      .option("-n, --non-interactive", "Run without interactive prompts")
      .option("-a, --agent <name>", "AI agent to use");

    registerSwitchSkillsetCommand({ program });

    // Reset mock to track this specific call
    mockInstallMain.mockClear();

    // Mock claude-code's switchSkillset
    const claudeAgent = AgentRegistry.getInstance().get({
      name: "claude-code",
    });
    vi.spyOn(claudeAgent, "switchSkillset").mockResolvedValue(undefined);

    try {
      await program.parseAsync([
        "node",
        "nori-skillsets",
        "switch-skillset",
        "senior-swe",
        "--non-interactive",
        "--install-dir",
        testInstallDir,
        "--non-interactive",
      ]);
    } catch {
      // May throw due to exit
    }

    // Verify installMain was called with silent: true
    expect(mockInstallMain).toHaveBeenCalledWith(
      expect.objectContaining({
        silent: true,
        nonInteractive: true,
      }),
    );
  });
});

describe("switch-skillset installDir resolution from config", () => {
  let testInstallDir: string;
  let customInstallDir: string;

  beforeEach(async () => {
    testInstallDir = await fs.realpath(
      await fs.mkdtemp(path.join(tmpdir(), "switch-skillset-configdir-test-")),
    );
    customInstallDir = await fs.realpath(
      await fs.mkdtemp(path.join(tmpdir(), "switch-skillset-customdir-test-")),
    );
    vi.mocked(os.homedir).mockReturnValue(testInstallDir);

    // Create skillsets directory with test skillsets
    const noriDir = path.join(testInstallDir, ".nori");
    const skillsetsDir = path.join(noriDir, "profiles");
    await fs.mkdir(skillsetsDir, { recursive: true });
    for (const name of ["senior-swe", "product-manager"]) {
      const dir = path.join(skillsetsDir, name);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(
        path.join(dir, "nori.json"),
        JSON.stringify({ name, version: "1.0.0" }),
      );
    }

    AgentRegistry.resetInstance();
    mockSwitchSkillsetFlow.mockReset();
  });

  afterEach(async () => {
    if (testInstallDir) {
      await fs.rm(testInstallDir, { recursive: true, force: true });
    }
    if (customInstallDir) {
      await fs.rm(customInstallDir, { recursive: true, force: true });
    }
    AgentRegistry.resetInstance();
    vi.restoreAllMocks();
  });

  it("should use config.installDir when no --install-dir flag is provided", async () => {
    // Config has a custom installDir that differs from home directory
    const configPath = path.join(testInstallDir, ".nori-config.json");
    await fs.writeFile(
      configPath,
      JSON.stringify({
        activeSkillset: "senior-swe",
        installDir: customInstallDir,
      }),
    );

    mockSwitchSkillsetFlow.mockResolvedValueOnce({
      agentName: "claude-code",
      skillsetName: "product-manager",
    });

    const program = new Command();
    program.exitOverride();
    program.configureOutput({ writeErr: () => undefined });
    program
      .option("-d, --install-dir <path>", "Custom installation directory")
      .option("-n, --non-interactive", "Run without interactive prompts")
      .option("-a, --agent <name>", "AI agent to use");

    registerSwitchSkillsetCommand({ program });

    try {
      // NO --install-dir flag - should use config.installDir
      await program.parseAsync([
        "node",
        "nori-skillsets",
        "switch-skillset",
        "product-manager",
      ]);
    } catch {
      // May throw due to exit
    }

    // Should use the config installDir, NOT auto-detect or home dir
    expect(mockSwitchSkillsetFlow).toHaveBeenCalledWith(
      expect.objectContaining({
        skillsetName: "product-manager",
        installDir: customInstallDir,
      }),
    );
  });

  it("should fall back to home directory when no config exists and no --install-dir flag", async () => {
    // No config file at all - should fall back to home dir
    mockSwitchSkillsetFlow.mockResolvedValueOnce({
      agentName: "claude-code",
      skillsetName: "product-manager",
    });

    const program = new Command();
    program.exitOverride();
    program.configureOutput({ writeErr: () => undefined });
    program
      .option("-d, --install-dir <path>", "Custom installation directory")
      .option("-n, --non-interactive", "Run without interactive prompts")
      .option("-a, --agent <name>", "AI agent to use");

    registerSwitchSkillsetCommand({ program });

    try {
      await program.parseAsync([
        "node",
        "nori-skillsets",
        "switch-skillset",
        "product-manager",
      ]);
    } catch {
      // May throw due to exit
    }

    // Should fall back to home directory
    expect(mockSwitchSkillsetFlow).toHaveBeenCalledWith(
      expect.objectContaining({
        skillsetName: "product-manager",
        installDir: testInstallDir,
      }),
    );
  });
});

describe("switch-skillset local change detection", () => {
  let testInstallDir: string;

  beforeEach(async () => {
    testInstallDir = await fs.mkdtemp(
      path.join(tmpdir(), "switch-skillset-change-detection-test-"),
    );
    vi.mocked(os.homedir).mockReturnValue(testInstallDir);
    const testClaudeDir = path.join(testInstallDir, ".claude");
    const testNoriDir = path.join(testInstallDir, ".nori");
    await fs.mkdir(testClaudeDir, { recursive: true });
    await fs.mkdir(testNoriDir, { recursive: true });

    // Create skillsets directory with test skillsets
    const skillsetsDir = path.join(testNoriDir, "profiles");
    await fs.mkdir(skillsetsDir, { recursive: true });
    for (const name of ["senior-swe", "product-manager"]) {
      const dir = path.join(skillsetsDir, name);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(
        path.join(dir, "nori.json"),
        JSON.stringify({ name, version: "1.0.0" }),
      );
    }

    // Create config with current profile
    const configPath = path.join(testInstallDir, ".nori-config.json");
    await fs.writeFile(
      configPath,
      JSON.stringify({
        activeSkillset: "senior-swe",
      }),
    );

    AgentRegistry.resetInstance();
    mockSwitchSkillsetFlow.mockReset();
  });

  afterEach(async () => {
    if (testInstallDir) {
      await fs.rm(testInstallDir, { recursive: true, force: true });
    }
    AgentRegistry.resetInstance();
    vi.restoreAllMocks();
  });

  it("should error in non-interactive mode when changes detected", async () => {
    // Create skills directory with a file
    const skillsDir = path.join(testInstallDir, ".claude", "skills");
    const mySkillDir = path.join(skillsDir, "my-skill");
    await fs.mkdir(mySkillDir, { recursive: true });
    await fs.writeFile(path.join(mySkillDir, "SKILL.md"), "modified content");

    // Create manifest with different hash
    const manifestPath = path.join(
      testInstallDir,
      ".nori",
      "installed-manifest.json",
    );
    await fs.writeFile(
      manifestPath,
      JSON.stringify({
        version: 1,
        createdAt: new Date().toISOString(),
        skillsetName: "senior-swe",
        files: {
          "skills/my-skill/SKILL.md": "different-hash-representing-original",
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

    registerSwitchSkillsetCommand({ program });

    // Mock switchSkillset
    const claudeAgent = AgentRegistry.getInstance().get({
      name: "claude-code",
    });
    const switchSkillsetSpy = vi
      .spyOn(claudeAgent, "switchSkillset")
      .mockResolvedValue(undefined);

    let thrownError: Error | null = null;
    try {
      // No --install-dir flag: resolves from config/homedir so manifest is checked
      await program.parseAsync([
        "node",
        "nori-skillsets",
        "--non-interactive",
        "switch-skillset",
        "product-manager",
      ]);
    } catch (err) {
      thrownError = err as Error;
    }

    // Should error because changes detected in non-interactive mode
    expect(thrownError).not.toBeNull();
    // switchSkillset should NOT have been called
    expect(switchSkillsetSpy).not.toHaveBeenCalled();
  });

  it("should proceed in non-interactive mode when --force is used with local changes", async () => {
    // Create skills directory with a file
    const skillsDir = path.join(testInstallDir, ".claude", "skills");
    const mySkillDir = path.join(skillsDir, "my-skill");
    await fs.mkdir(mySkillDir, { recursive: true });
    await fs.writeFile(path.join(mySkillDir, "SKILL.md"), "modified content");

    // Create manifest with different hash (simulating user modification)
    const manifestPath = path.join(
      testInstallDir,
      ".nori",
      "installed-manifest.json",
    );
    await fs.writeFile(
      manifestPath,
      JSON.stringify({
        version: 1,
        createdAt: new Date().toISOString(),
        skillsetName: "senior-swe",
        files: {
          "skills/my-skill/SKILL.md": "different-hash-representing-original",
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

    registerSwitchSkillsetCommand({ program });

    // Mock switchSkillset
    const claudeAgent = AgentRegistry.getInstance().get({
      name: "claude-code",
    });
    const switchSkillsetSpy = vi
      .spyOn(claudeAgent, "switchSkillset")
      .mockResolvedValue(undefined);

    let thrownError: Error | null = null;
    try {
      // No --install-dir flag: resolves from config/homedir so manifest is checked
      await program.parseAsync([
        "node",
        "nori-skillsets",
        "--non-interactive",
        "switch-skillset",
        "product-manager",
        "--force",
      ]);
    } catch (err) {
      thrownError = err as Error;
    }

    // Should NOT error -- --force bypasses the local changes check
    expect(thrownError).toBeNull();
    // switchSkillset SHOULD have been called
    expect(switchSkillsetSpy).toHaveBeenCalledWith({
      installDir: testInstallDir,
      skillsetName: "product-manager",
    });
  });
});

describe("switch-skillset broadcasts to all default agents", () => {
  let testInstallDir: string;

  beforeEach(async () => {
    testInstallDir = await fs.mkdtemp(
      path.join(tmpdir(), "switch-skillset-broadcast-test-"),
    );
    vi.mocked(os.homedir).mockReturnValue(testInstallDir);
    const testClaudeDir = path.join(testInstallDir, ".claude");
    const testNoriDir = path.join(testInstallDir, ".nori");
    await fs.mkdir(testClaudeDir, { recursive: true });
    await fs.mkdir(testNoriDir, { recursive: true });

    // Create skillsets directory with test skillsets
    const skillsetsDir = path.join(testNoriDir, "profiles");
    await fs.mkdir(skillsetsDir, { recursive: true });
    for (const name of ["senior-swe", "product-manager"]) {
      const dir = path.join(skillsetsDir, name);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(
        path.join(dir, "nori.json"),
        JSON.stringify({ name, version: "1.0.0" }),
      );
    }

    // Create config with current profile
    const configPath = path.join(testInstallDir, ".nori-config.json");
    await fs.writeFile(
      configPath,
      JSON.stringify({
        activeSkillset: "senior-swe",
        defaultAgents: ["claude-code"],
        installDir: testInstallDir,
      }),
    );

    AgentRegistry.resetInstance();
    mockSwitchSkillsetFlow.mockReset();
    mockInstallMain.mockClear();
  });

  afterEach(async () => {
    if (testInstallDir) {
      await fs.rm(testInstallDir, { recursive: true, force: true });
    }
    AgentRegistry.resetInstance();
    vi.restoreAllMocks();
  });

  it("should call switchSkillset and installMain for each default agent in non-interactive mode", async () => {
    const program = new Command();
    program.exitOverride();
    program.configureOutput({ writeErr: () => undefined });
    program
      .option("-d, --install-dir <path>", "Custom installation directory")
      .option("-n, --non-interactive", "Run without interactive prompts")
      .option("-a, --agent <name>", "AI agent to use");

    registerSwitchSkillsetCommand({ program });

    // Mock switchSkillset on the agent
    const claudeAgent = AgentRegistry.getInstance().get({
      name: "claude-code",
    });
    const switchSkillsetSpy = vi
      .spyOn(claudeAgent, "switchSkillset")
      .mockResolvedValue(undefined);

    try {
      await program.parseAsync([
        "node",
        "nori-skillsets",
        "--non-interactive",
        "switch-skillset",
        "product-manager",
        "--install-dir",
        testInstallDir,
      ]);
    } catch {
      // May throw due to exit
    }

    // switchSkillset should have been called for each agent
    expect(switchSkillsetSpy).toHaveBeenCalledWith({
      installDir: testInstallDir,
      skillsetName: "product-manager",
    });

    // installMain should have been called for each agent
    expect(mockInstallMain).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: "claude-code",
        silent: true,
      }),
    );
  });
});

describe("switch-skillset activeSkillset persistence with --install-dir override", () => {
  let testInstallDir: string;
  let overrideInstallDir: string;

  beforeEach(async () => {
    testInstallDir = await fs.realpath(
      await fs.mkdtemp(
        path.join(tmpdir(), "switch-skillset-activeskillset-test-"),
      ),
    );
    overrideInstallDir = await fs.realpath(
      await fs.mkdtemp(
        path.join(tmpdir(), "switch-skillset-activeskillset-override-"),
      ),
    );
    vi.mocked(os.homedir).mockReturnValue(testInstallDir);
    const testClaudeDir = path.join(testInstallDir, ".claude");
    const testNoriDir = path.join(testInstallDir, ".nori");
    await fs.mkdir(testClaudeDir, { recursive: true });
    await fs.mkdir(testNoriDir, { recursive: true });

    // Create skillsets directory with test skillsets
    const skillsetsDir = path.join(testNoriDir, "profiles");
    await fs.mkdir(skillsetsDir, { recursive: true });
    for (const name of ["senior-swe", "product-manager"]) {
      const dir = path.join(skillsetsDir, name);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(
        path.join(dir, "nori.json"),
        JSON.stringify({ name, version: "1.0.0" }),
      );
    }

    AgentRegistry.resetInstance();
    mockSwitchSkillsetFlow.mockReset();
    mockInstallMain.mockClear();
  });

  afterEach(async () => {
    if (testInstallDir) {
      await fs.rm(testInstallDir, { recursive: true, force: true });
    }
    if (overrideInstallDir) {
      await fs.rm(overrideInstallDir, { recursive: true, force: true });
    }
    AgentRegistry.resetInstance();
    vi.restoreAllMocks();
  });

  it("should NOT persist activeSkillset when --install-dir override is used", async () => {
    const configPath = path.join(testInstallDir, ".nori-config.json");
    await fs.writeFile(
      configPath,
      JSON.stringify({
        activeSkillset: "senior-swe",
        defaultAgents: ["claude-code"],
        installDir: testInstallDir,
      }),
    );

    const program = new Command();
    program.exitOverride();
    program.configureOutput({ writeErr: () => undefined });
    program
      .option("-d, --install-dir <path>", "Custom installation directory")
      .option("-n, --non-interactive", "Run without interactive prompts")
      .option("-a, --agent <name>", "AI agent to use");

    registerSwitchSkillsetCommand({ program });

    const claudeAgent = AgentRegistry.getInstance().get({
      name: "claude-code",
    });
    vi.spyOn(claudeAgent, "switchSkillset").mockResolvedValue(undefined);

    try {
      await program.parseAsync([
        "node",
        "nori-skillsets",
        "--non-interactive",
        "switch-skillset",
        "product-manager",
        "--install-dir",
        overrideInstallDir,
      ]);
    } catch {
      // May throw due to exit
    }

    // activeSkillset should NOT have changed because --install-dir is transient
    const updatedConfig = JSON.parse(await fs.readFile(configPath, "utf-8"));
    expect(updatedConfig.activeSkillset).toBe("senior-swe");
  });

  it("should persist activeSkillset when no --install-dir override is used", async () => {
    const configPath = path.join(testInstallDir, ".nori-config.json");
    await fs.writeFile(
      configPath,
      JSON.stringify({
        activeSkillset: "senior-swe",
        defaultAgents: ["claude-code"],
        installDir: testInstallDir,
      }),
    );

    const program = new Command();
    program.exitOverride();
    program.configureOutput({ writeErr: () => undefined });
    program
      .option("-d, --install-dir <path>", "Custom installation directory")
      .option("-n, --non-interactive", "Run without interactive prompts")
      .option("-a, --agent <name>", "AI agent to use");

    registerSwitchSkillsetCommand({ program });

    const claudeAgent = AgentRegistry.getInstance().get({
      name: "claude-code",
    });
    vi.spyOn(claudeAgent, "switchSkillset").mockResolvedValue(undefined);

    try {
      await program.parseAsync([
        "node",
        "nori-skillsets",
        "--non-interactive",
        "switch-skillset",
        "product-manager",
      ]);
    } catch {
      // May throw due to exit
    }

    // activeSkillset SHOULD be updated because no --install-dir override
    const updatedConfig = JSON.parse(await fs.readFile(configPath, "utf-8"));
    expect(updatedConfig.activeSkillset).toBe("product-manager");
  });
});

describe("switch-skillset does not persist --install-dir override to config", () => {
  let testInstallDir: string;
  let overrideInstallDir: string;

  beforeEach(async () => {
    testInstallDir = await fs.realpath(
      await fs.mkdtemp(path.join(tmpdir(), "switch-skillset-installdir-test-")),
    );
    overrideInstallDir = await fs.realpath(
      await fs.mkdtemp(path.join(tmpdir(), "switch-skillset-override-dir-")),
    );
    vi.mocked(os.homedir).mockReturnValue(testInstallDir);
    const testClaudeDir = path.join(testInstallDir, ".claude");
    const testNoriDir = path.join(testInstallDir, ".nori");
    await fs.mkdir(testClaudeDir, { recursive: true });
    await fs.mkdir(testNoriDir, { recursive: true });

    // Create skillsets directory with test skillsets
    const skillsetsDir = path.join(testNoriDir, "profiles");
    await fs.mkdir(skillsetsDir, { recursive: true });
    for (const name of ["senior-swe", "product-manager"]) {
      const dir = path.join(skillsetsDir, name);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(
        path.join(dir, "nori.json"),
        JSON.stringify({ name, version: "1.0.0" }),
      );
    }

    AgentRegistry.resetInstance();
    mockSwitchSkillsetFlow.mockReset();
    mockInstallMain.mockClear();
  });

  afterEach(async () => {
    if (testInstallDir) {
      await fs.rm(testInstallDir, { recursive: true, force: true });
    }
    if (overrideInstallDir) {
      await fs.rm(overrideInstallDir, { recursive: true, force: true });
    }
    AgentRegistry.resetInstance();
    vi.restoreAllMocks();
  });

  it("should preserve config installDir when --install-dir override is used in non-interactive mode", async () => {
    // Config has installDir set to testInstallDir
    const configPath = path.join(testInstallDir, ".nori-config.json");
    await fs.writeFile(
      configPath,
      JSON.stringify({
        activeSkillset: "senior-swe",
        defaultAgents: ["claude-code"],
        installDir: testInstallDir,
      }),
    );

    const program = new Command();
    program.exitOverride();
    program.configureOutput({ writeErr: () => undefined });
    program
      .option("-d, --install-dir <path>", "Custom installation directory")
      .option("-n, --non-interactive", "Run without interactive prompts")
      .option("-a, --agent <name>", "AI agent to use");

    registerSwitchSkillsetCommand({ program });

    const claudeAgent = AgentRegistry.getInstance().get({
      name: "claude-code",
    });
    vi.spyOn(claudeAgent, "switchSkillset").mockResolvedValue(undefined);

    try {
      await program.parseAsync([
        "node",
        "nori-skillsets",
        "--non-interactive",
        "switch-skillset",
        "product-manager",
        "--install-dir",
        overrideInstallDir,
      ]);
    } catch {
      // May throw due to exit
    }

    // Config's installDir should still be the original, NOT the override
    const updatedConfig = JSON.parse(await fs.readFile(configPath, "utf-8"));
    expect(updatedConfig.installDir).toBe(testInstallDir);
  });
});

describe("switch-skillset onCaptureConfig broadcasts to all agents", () => {
  let testInstallDir: string;

  beforeEach(async () => {
    testInstallDir = await fs.mkdtemp(
      path.join(tmpdir(), "switch-skillset-capture-test-"),
    );
    vi.mocked(os.homedir).mockReturnValue(testInstallDir);
    const testClaudeDir = path.join(testInstallDir, ".claude");
    const testNoriDir = path.join(testInstallDir, ".nori");
    await fs.mkdir(testClaudeDir, { recursive: true });
    await fs.mkdir(testNoriDir, { recursive: true });

    // Create skillsets directory with test skillsets
    const skillsetsDir = path.join(testNoriDir, "profiles");
    await fs.mkdir(skillsetsDir, { recursive: true });
    for (const name of ["senior-swe", "product-manager"]) {
      const dir = path.join(skillsetsDir, name);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(
        path.join(dir, "nori.json"),
        JSON.stringify({ name, version: "1.0.0" }),
      );
    }

    // Create config with current profile
    const configPath = path.join(testInstallDir, ".nori-config.json");
    await fs.writeFile(
      configPath,
      JSON.stringify({
        activeSkillset: "senior-swe",
        defaultAgents: ["claude-code"],
        installDir: testInstallDir,
      }),
    );

    AgentRegistry.resetInstance();
    mockSwitchSkillsetFlow.mockReset();
  });

  afterEach(async () => {
    if (testInstallDir) {
      await fs.rm(testInstallDir, { recursive: true, force: true });
    }
    AgentRegistry.resetInstance();
    vi.restoreAllMocks();
  });

  it("should pass onCaptureConfig callback that captures for all default agents", async () => {
    // Capture the callbacks passed to switchSkillsetFlow
    let capturedCallbacks: any = null;
    mockSwitchSkillsetFlow.mockImplementationOnce(async (args: any) => {
      capturedCallbacks = args.callbacks;
      return { agentName: "claude-code", skillsetName: "product-manager" };
    });

    const program = new Command();
    program.exitOverride();
    program.configureOutput({ writeErr: () => undefined });
    program
      .option("-d, --install-dir <path>", "Custom installation directory")
      .option("-n, --non-interactive", "Run without interactive prompts")
      .option("-a, --agent <name>", "AI agent to use");

    registerSwitchSkillsetCommand({ program });

    // Spy on captureExistingConfig on the actual agent instance
    const claudeAgent = AgentRegistry.getInstance().get({
      name: "claude-code",
    });
    const originalCapture = claudeAgent.captureExistingConfig;
    const captureExistingConfigSpy = vi.fn().mockResolvedValue(undefined);
    claudeAgent.captureExistingConfig = captureExistingConfigSpy;

    try {
      await program.parseAsync([
        "node",
        "nori-skillsets",
        "switch-skillset",
        "product-manager",
        "--install-dir",
        testInstallDir,
      ]);
    } catch {
      // May throw due to exit
    }

    // Now invoke onCaptureConfig to verify it calls captureExistingConfig for all agents
    expect(capturedCallbacks).not.toBeNull();
    await capturedCallbacks.onCaptureConfig({
      installDir: testInstallDir,
      skillsetName: "my-captured-config",
    });

    // captureExistingConfig should have been called for each default agent
    expect(captureExistingConfigSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        installDir: testInstallDir,
        skillsetName: "my-captured-config",
      }),
    );

    // Restore original
    claudeAgent.captureExistingConfig = originalCapture;
  });
});

describe("switch-skillset interactive flow routing", () => {
  let testInstallDir: string;

  beforeEach(async () => {
    testInstallDir = await fs.mkdtemp(
      path.join(tmpdir(), "switch-skillset-flow-test-"),
    );
    vi.mocked(os.homedir).mockReturnValue(testInstallDir);
    const testClaudeDir = path.join(testInstallDir, ".claude");
    const testNoriDir = path.join(testInstallDir, ".nori");
    await fs.mkdir(testClaudeDir, { recursive: true });
    await fs.mkdir(testNoriDir, { recursive: true });

    // Create skillsets directory with test skillsets
    const skillsetsDir = path.join(testNoriDir, "profiles");
    await fs.mkdir(skillsetsDir, { recursive: true });
    for (const name of ["senior-swe", "product-manager"]) {
      const dir = path.join(skillsetsDir, name);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, "CLAUDE.md"), `# ${name}`);
    }

    // Create config with current profile
    const configPath = path.join(testInstallDir, ".nori-config.json");
    await fs.writeFile(
      configPath,
      JSON.stringify({
        activeSkillset: "senior-swe",
      }),
    );

    AgentRegistry.resetInstance();
    mockSwitchSkillsetFlow.mockReset();
  });

  afterEach(async () => {
    if (testInstallDir) {
      await fs.rm(testInstallDir, { recursive: true, force: true });
    }
    AgentRegistry.resetInstance();
    vi.restoreAllMocks();
  });

  it("should pass onExecuteSwitch callback that calls switchSkillset and installMain for the given agent", async () => {
    // Set up config with multiple agents
    const configPath = path.join(testInstallDir, ".nori-config.json");
    await fs.writeFile(
      configPath,
      JSON.stringify({
        activeSkillset: "senior-swe",
        defaultAgents: ["claude-code"],
        installDir: testInstallDir,
      }),
    );

    // Capture the callbacks passed to switchSkillsetFlow
    let capturedCallbacks: any = null;
    mockSwitchSkillsetFlow.mockImplementationOnce(async (args: any) => {
      capturedCallbacks = args.callbacks;
      // Simulate flow executing the switch for one agent
      await args.callbacks.onExecuteSwitch({
        installDir: args.installDir,
        agentName: "claude-code",
        skillsetName: args.skillsetName,
      });
      return { agentName: "claude-code", skillsetName: args.skillsetName };
    });

    const program = new Command();
    program.exitOverride();
    program.configureOutput({ writeErr: () => undefined });
    program
      .option("-d, --install-dir <path>", "Custom installation directory")
      .option("-n, --non-interactive", "Run without interactive prompts")
      .option("-a, --agent <name>", "AI agent to use");

    registerSwitchSkillsetCommand({ program });

    const claudeAgent = AgentRegistry.getInstance().get({
      name: "claude-code",
    });
    vi.spyOn(claudeAgent, "switchSkillset").mockResolvedValue(undefined);

    try {
      await program.parseAsync([
        "node",
        "nori-skillsets",
        "switch-skillset",
        "product-manager",
        "--install-dir",
        testInstallDir,
      ]);
    } catch {
      // May throw due to exit
    }

    // Verify the callback was invoked with the agent
    expect(capturedCallbacks).not.toBeNull();
    expect(claudeAgent.switchSkillset).toHaveBeenCalledWith({
      installDir: testInstallDir,
      skillsetName: "product-manager",
    });
    expect(mockInstallMain).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: "claude-code",
        silent: true,
      }),
    );
  });

  it("should use switchSkillsetFlow in interactive mode", async () => {
    mockSwitchSkillsetFlow.mockResolvedValueOnce({
      agentName: "claude-code",
      skillsetName: "product-manager",
    });

    const program = new Command();
    program.exitOverride();
    program.configureOutput({ writeErr: () => undefined });
    program
      .option("-d, --install-dir <path>", "Custom installation directory")
      .option("-n, --non-interactive", "Run without interactive prompts")
      .option("-a, --agent <name>", "AI agent to use");

    registerSwitchSkillsetCommand({ program });

    // Mock switchSkillset on the agent
    const claudeAgent = AgentRegistry.getInstance().get({
      name: "claude-code",
    });
    vi.spyOn(claudeAgent, "switchSkillset").mockResolvedValue(undefined);

    try {
      await program.parseAsync([
        "node",
        "nori-skillsets",
        "switch-skillset",
        "product-manager",
        "--install-dir",
        testInstallDir,
      ]);
    } catch {
      // May throw due to exit
    }

    // switchSkillsetFlow should have been called
    expect(mockSwitchSkillsetFlow).toHaveBeenCalledTimes(1);
    expect(mockSwitchSkillsetFlow).toHaveBeenCalledWith(
      expect.objectContaining({
        skillsetName: "product-manager",
        installDir: testInstallDir,
      }),
    );
  });

  it("should not use switchSkillsetFlow in non-interactive mode", async () => {
    const program = new Command();
    program.exitOverride();
    program.configureOutput({ writeErr: () => undefined });
    program
      .option("-d, --install-dir <path>", "Custom installation directory")
      .option("-n, --non-interactive", "Run without interactive prompts")
      .option("-a, --agent <name>", "AI agent to use");

    registerSwitchSkillsetCommand({ program });

    // Mock switchSkillset on the agent
    const claudeAgent = AgentRegistry.getInstance().get({
      name: "claude-code",
    });
    vi.spyOn(claudeAgent, "switchSkillset").mockResolvedValue(undefined);

    try {
      await program.parseAsync([
        "node",
        "nori-skillsets",
        "--non-interactive",
        "switch-skillset",
        "product-manager",
        "--install-dir",
        testInstallDir,
      ]);
    } catch {
      // May throw due to exit
    }

    // switchSkillsetFlow should NOT have been called in non-interactive mode
    expect(mockSwitchSkillsetFlow).not.toHaveBeenCalled();
  });
});

describe("switch-skillset interactive selection when no name provided", () => {
  let testInstallDir: string;

  beforeEach(async () => {
    testInstallDir = await fs.mkdtemp(
      path.join(tmpdir(), "switch-skillset-noname-test-"),
    );
    vi.mocked(os.homedir).mockReturnValue(testInstallDir);
    const testClaudeDir = path.join(testInstallDir, ".claude");
    const testNoriDir = path.join(testInstallDir, ".nori");
    await fs.mkdir(testClaudeDir, { recursive: true });
    await fs.mkdir(testNoriDir, { recursive: true });

    AgentRegistry.resetInstance();
    mockSwitchSkillsetFlow.mockReset();
    mockListSkillsets.mockReset();
    mockSelect.mockReset();
  });

  afterEach(async () => {
    if (testInstallDir) {
      await fs.rm(testInstallDir, { recursive: true, force: true });
    }
    AgentRegistry.resetInstance();
    vi.restoreAllMocks();
  });

  it("should show select prompt and pass chosen skillset to flow when no name provided", async () => {
    mockListSkillsets.mockResolvedValueOnce([
      "senior-swe",
      "product-manager",
      "data-engineer",
    ]);
    mockSelect.mockResolvedValueOnce("product-manager");
    mockSwitchSkillsetFlow.mockResolvedValueOnce({
      agentName: "claude-code",
      skillsetName: "product-manager",
    });

    const program = new Command();
    program.exitOverride();
    program.configureOutput({ writeErr: () => undefined });
    program
      .option("-d, --install-dir <path>", "Custom installation directory")
      .option("-n, --non-interactive", "Run without interactive prompts")
      .option("-a, --agent <name>", "AI agent to use");

    registerSwitchSkillsetCommand({ program });

    await program.parseAsync([
      "node",
      "nori-skillsets",
      "switch-skillset",
      "--install-dir",
      testInstallDir,
    ]);

    // Should have called listSkillsets to discover available skillsets
    expect(mockListSkillsets).toHaveBeenCalled();

    // Should have shown a select prompt with the available skillsets
    expect(mockSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.any(String),
        options: expect.arrayContaining([
          expect.objectContaining({ value: "senior-swe" }),
          expect.objectContaining({ value: "product-manager" }),
          expect.objectContaining({ value: "data-engineer" }),
        ]),
      }),
    );

    // Should have passed the selected skillset name to the flow
    expect(mockSwitchSkillsetFlow).toHaveBeenCalledWith(
      expect.objectContaining({
        skillsetName: "product-manager",
      }),
    );
  });

  it("should error when no name provided in non-interactive mode", async () => {
    mockListSkillsets.mockResolvedValueOnce(["senior-swe", "product-manager"]);

    const program = new Command();
    program.exitOverride();
    program.configureOutput({ writeErr: () => undefined });
    program
      .option("-d, --install-dir <path>", "Custom installation directory")
      .option("-n, --non-interactive", "Run without interactive prompts")
      .option("-a, --agent <name>", "AI agent to use");

    registerSwitchSkillsetCommand({ program });

    let thrownError: Error | null = null;
    try {
      await program.parseAsync([
        "node",
        "nori-skillsets",
        "--non-interactive",
        "switch-skillset",
        "--install-dir",
        testInstallDir,
      ]);
    } catch (err) {
      thrownError = err as Error;
    }

    // Should error because no name provided in non-interactive mode
    expect(thrownError).not.toBeNull();
    expect(thrownError?.message).toContain("No skillset name provided");
    expect(thrownError?.message).toContain("Usage: sks switch");
    // Should NOT have called the flow
    expect(mockSwitchSkillsetFlow).not.toHaveBeenCalled();
  });

  it("should error when no skillsets are available", async () => {
    mockListSkillsets.mockResolvedValueOnce([]);

    const program = new Command();
    program.exitOverride();
    program.configureOutput({ writeErr: () => undefined });
    program
      .option("-d, --install-dir <path>", "Custom installation directory")
      .option("-n, --non-interactive", "Run without interactive prompts")
      .option("-a, --agent <name>", "AI agent to use");

    registerSwitchSkillsetCommand({ program });

    let thrownError: Error | null = null;
    try {
      await program.parseAsync([
        "node",
        "nori-skillsets",
        "switch-skillset",
        "--install-dir",
        testInstallDir,
      ]);
    } catch (err) {
      thrownError = err as Error;
    }

    // Should error because no skillsets are installed
    expect(thrownError).not.toBeNull();
    expect(thrownError?.message).toContain("No skillsets installed");
    // Should NOT have shown select or called flow
    expect(mockSelect).not.toHaveBeenCalled();
    expect(mockSwitchSkillsetFlow).not.toHaveBeenCalled();
  });

  it("should handle cancel from select prompt gracefully", async () => {
    const clack = await import("@clack/prompts");
    mockListSkillsets.mockResolvedValueOnce(["senior-swe"]);
    mockSelect.mockResolvedValueOnce(Symbol("cancel"));
    vi.mocked(clack.isCancel).mockReturnValueOnce(true);

    const program = new Command();
    program.exitOverride();
    program.configureOutput({ writeErr: () => undefined });
    program
      .option("-d, --install-dir <path>", "Custom installation directory")
      .option("-n, --non-interactive", "Run without interactive prompts")
      .option("-a, --agent <name>", "AI agent to use");

    registerSwitchSkillsetCommand({ program });

    await program.parseAsync([
      "node",
      "nori-skillsets",
      "switch-skillset",
      "--install-dir",
      testInstallDir,
    ]);

    // Should NOT have called the flow since user cancelled
    expect(mockSwitchSkillsetFlow).not.toHaveBeenCalled();
  });
});

describe("switch-skillset skips manifest operations when --install-dir is used", () => {
  let testInstallDir: string;
  let overrideInstallDir: string;

  beforeEach(async () => {
    testInstallDir = await fs.realpath(
      await fs.mkdtemp(
        path.join(tmpdir(), "switch-skillset-skip-manifest-test-"),
      ),
    );
    overrideInstallDir = await fs.realpath(
      await fs.mkdtemp(
        path.join(tmpdir(), "switch-skillset-skip-manifest-override-"),
      ),
    );
    vi.mocked(os.homedir).mockReturnValue(testInstallDir);
    const testClaudeDir = path.join(testInstallDir, ".claude");
    const testNoriDir = path.join(testInstallDir, ".nori");
    await fs.mkdir(testClaudeDir, { recursive: true });
    await fs.mkdir(testNoriDir, { recursive: true });

    // Create skillsets directory with test skillsets
    const skillsetsDir = path.join(testNoriDir, "profiles");
    await fs.mkdir(skillsetsDir, { recursive: true });
    for (const name of ["senior-swe", "product-manager"]) {
      const dir = path.join(skillsetsDir, name);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(
        path.join(dir, "nori.json"),
        JSON.stringify({ name, version: "1.0.0" }),
      );
    }

    AgentRegistry.resetInstance();
    mockSwitchSkillsetFlow.mockReset();
    mockInstallMain.mockClear();
  });

  afterEach(async () => {
    if (testInstallDir) {
      await fs.rm(testInstallDir, { recursive: true, force: true });
    }
    if (overrideInstallDir) {
      await fs.rm(overrideInstallDir, { recursive: true, force: true });
    }
    AgentRegistry.resetInstance();
    vi.restoreAllMocks();
  });

  it("should skip detectLocalChanges in non-interactive mode when --install-dir is provided", async () => {
    // Set up a manifest that would cause false "deleted" warnings if consulted
    const configPath = path.join(testInstallDir, ".nori-config.json");
    await fs.writeFile(
      configPath,
      JSON.stringify({
        activeSkillset: "senior-swe",
        defaultAgents: ["claude-code"],
        installDir: testInstallDir,
      }),
    );

    // Create a manifest at the global location with files that don't exist at overrideInstallDir
    const manifestDir = path.join(testInstallDir, ".nori", "manifests");
    await fs.mkdir(manifestDir, { recursive: true });
    await fs.writeFile(
      path.join(manifestDir, "claude-code.json"),
      JSON.stringify({
        version: 1,
        createdAt: new Date().toISOString(),
        skillsetName: "senior-swe",
        files: {
          "skills/my-skill/SKILL.md": "some-hash-from-different-dir",
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

    registerSwitchSkillsetCommand({ program });

    const claudeAgent = AgentRegistry.getInstance().get({
      name: "claude-code",
    });
    vi.spyOn(claudeAgent, "switchSkillset").mockResolvedValue(undefined);

    // This should NOT error even though the manifest has files that don't exist
    // at overrideInstallDir, because --install-dir should skip manifest checks
    let thrownError: Error | null = null;
    try {
      await program.parseAsync([
        "node",
        "nori-skillsets",
        "--non-interactive",
        "switch-skillset",
        "product-manager",
        "--install-dir",
        overrideInstallDir,
      ]);
    } catch (err) {
      thrownError = err as Error;
    }

    expect(thrownError).toBeNull();
    expect(claudeAgent.switchSkillset).toHaveBeenCalled();
  });

  it("should pass skipManifest to installMain in non-interactive mode when --install-dir is provided", async () => {
    const configPath = path.join(testInstallDir, ".nori-config.json");
    await fs.writeFile(
      configPath,
      JSON.stringify({
        activeSkillset: "senior-swe",
        defaultAgents: ["claude-code"],
        installDir: testInstallDir,
      }),
    );

    const program = new Command();
    program.exitOverride();
    program.configureOutput({ writeErr: () => undefined });
    program
      .option("-d, --install-dir <path>", "Custom installation directory")
      .option("-n, --non-interactive", "Run without interactive prompts")
      .option("-a, --agent <name>", "AI agent to use");

    registerSwitchSkillsetCommand({ program });

    const claudeAgent = AgentRegistry.getInstance().get({
      name: "claude-code",
    });
    vi.spyOn(claudeAgent, "switchSkillset").mockResolvedValue(undefined);

    try {
      await program.parseAsync([
        "node",
        "nori-skillsets",
        "--non-interactive",
        "switch-skillset",
        "product-manager",
        "--install-dir",
        overrideInstallDir,
      ]);
    } catch {
      // May throw due to exit
    }

    // installMain should be called with skipManifest: true
    expect(mockInstallMain).toHaveBeenCalledWith(
      expect.objectContaining({
        skipManifest: true,
      }),
    );
  });

  it("should NOT pass skipManifest when no --install-dir flag is provided in non-interactive mode", async () => {
    const configPath = path.join(testInstallDir, ".nori-config.json");
    await fs.writeFile(
      configPath,
      JSON.stringify({
        activeSkillset: "senior-swe",
        defaultAgents: ["claude-code"],
        installDir: testInstallDir,
      }),
    );

    const program = new Command();
    program.exitOverride();
    program.configureOutput({ writeErr: () => undefined });
    program
      .option("-d, --install-dir <path>", "Custom installation directory")
      .option("-n, --non-interactive", "Run without interactive prompts")
      .option("-a, --agent <name>", "AI agent to use");

    registerSwitchSkillsetCommand({ program });

    const claudeAgent = AgentRegistry.getInstance().get({
      name: "claude-code",
    });
    vi.spyOn(claudeAgent, "switchSkillset").mockResolvedValue(undefined);

    try {
      await program.parseAsync([
        "node",
        "nori-skillsets",
        "--non-interactive",
        "switch-skillset",
        "product-manager",
      ]);
    } catch {
      // May throw due to exit
    }

    // installMain should NOT have skipManifest: true
    expect(mockInstallMain).toHaveBeenCalledWith(
      expect.not.objectContaining({
        skipManifest: true,
      }),
    );
  });

  it("should pass skipManifest to installMain in interactive mode when --install-dir is provided", async () => {
    const configPath = path.join(testInstallDir, ".nori-config.json");
    await fs.writeFile(
      configPath,
      JSON.stringify({
        activeSkillset: "senior-swe",
        defaultAgents: ["claude-code"],
        installDir: testInstallDir,
      }),
    );

    // Capture the callbacks and invoke onExecuteSwitch
    mockSwitchSkillsetFlow.mockImplementationOnce(async (args: any) => {
      await args.callbacks.onExecuteSwitch({
        installDir: args.installDir,
        agentName: "claude-code",
        skillsetName: args.skillsetName,
      });
      return { agentName: "claude-code", skillsetName: args.skillsetName };
    });

    const program = new Command();
    program.exitOverride();
    program.configureOutput({ writeErr: () => undefined });
    program
      .option("-d, --install-dir <path>", "Custom installation directory")
      .option("-n, --non-interactive", "Run without interactive prompts")
      .option("-a, --agent <name>", "AI agent to use");

    registerSwitchSkillsetCommand({ program });

    const claudeAgent = AgentRegistry.getInstance().get({
      name: "claude-code",
    });
    vi.spyOn(claudeAgent, "switchSkillset").mockResolvedValue(undefined);

    try {
      await program.parseAsync([
        "node",
        "nori-skillsets",
        "switch-skillset",
        "product-manager",
        "--install-dir",
        overrideInstallDir,
      ]);
    } catch {
      // May throw due to exit
    }

    // installMain should be called with skipManifest: true
    expect(mockInstallMain).toHaveBeenCalledWith(
      expect.objectContaining({
        skipManifest: true,
      }),
    );
  });

  it("should return null localChanges in interactive onPrepareSwitchInfo when --install-dir is provided", async () => {
    const configPath = path.join(testInstallDir, ".nori-config.json");
    await fs.writeFile(
      configPath,
      JSON.stringify({
        activeSkillset: "senior-swe",
        defaultAgents: ["claude-code"],
        installDir: testInstallDir,
      }),
    );

    // Create a manifest that would trigger changes if compared against overrideInstallDir
    const manifestDir = path.join(testInstallDir, ".nori", "manifests");
    await fs.mkdir(manifestDir, { recursive: true });
    await fs.writeFile(
      path.join(manifestDir, "claude-code.json"),
      JSON.stringify({
        version: 1,
        createdAt: new Date().toISOString(),
        skillsetName: "senior-swe",
        files: {
          "skills/my-skill/SKILL.md": "some-hash",
        },
      }),
    );

    // Capture the callbacks and invoke onPrepareSwitchInfo
    let switchInfo: any = null;
    mockSwitchSkillsetFlow.mockImplementationOnce(async (args: any) => {
      switchInfo = await args.callbacks.onPrepareSwitchInfo({
        installDir: args.installDir,
        agentName: "claude-code",
      });
      return { agentName: "claude-code", skillsetName: args.skillsetName };
    });

    const program = new Command();
    program.exitOverride();
    program.configureOutput({ writeErr: () => undefined });
    program
      .option("-d, --install-dir <path>", "Custom installation directory")
      .option("-n, --non-interactive", "Run without interactive prompts")
      .option("-a, --agent <name>", "AI agent to use");

    registerSwitchSkillsetCommand({ program });

    try {
      await program.parseAsync([
        "node",
        "nori-skillsets",
        "switch-skillset",
        "product-manager",
        "--install-dir",
        overrideInstallDir,
      ]);
    } catch {
      // May throw due to exit
    }

    // localChanges should be null (skipped) because --install-dir was provided
    expect(switchInfo).not.toBeNull();
    expect(switchInfo.localChanges).toBeNull();
  });
});
