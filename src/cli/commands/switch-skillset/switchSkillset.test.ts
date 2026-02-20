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

  it("should preserve version when switching skillsets for claude-code", async () => {
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

    // Create initial config with version
    const configPath = path.join(testInstallDir, ".nori-config.json");
    const initialConfig = {
      activeSkillset: "profile-a",
      version: "v19.0.0",
    };
    await fs.writeFile(configPath, JSON.stringify(initialConfig, null, 2));

    // Switch to profile-b using agent method
    const agent = AgentRegistry.getInstance().get({ name: "claude-code" });
    await agent.switchSkillset({
      installDir: testInstallDir,
      skillsetName: "profile-b",
    });

    // Verify version was preserved
    const updatedConfig = JSON.parse(await fs.readFile(configPath, "utf-8"));
    expect(updatedConfig.activeSkillset).toBe("profile-b");
    expect(updatedConfig.version).toBe("v19.0.0");
  });

  it("should preserve refreshToken when switching skillsets for claude-code", async () => {
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

    // Create initial config with auth containing refreshToken
    const configPath = path.join(testInstallDir, ".nori-config.json");
    const initialConfig = {
      activeSkillset: "profile-a",
      auth: {
        username: "test@example.com",
        refreshToken: "test-refresh-token-12345",
        organizationUrl: "https://org.example.com",
      },
    };
    await fs.writeFile(configPath, JSON.stringify(initialConfig, null, 2));

    // Switch to profile-b using agent method
    const agent = AgentRegistry.getInstance().get({ name: "claude-code" });
    await agent.switchSkillset({
      installDir: testInstallDir,
      skillsetName: "profile-b",
    });

    // Verify refreshToken was preserved
    const updatedConfig = JSON.parse(await fs.readFile(configPath, "utf-8"));
    expect(updatedConfig.activeSkillset).toBe("profile-b");
    expect(updatedConfig.auth?.refreshToken).toBe("test-refresh-token-12345");
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
      await program.parseAsync([
        "node",
        "nori-skillsets",
        "--non-interactive",
        "switch-skillset",
        "product-manager",
        "--install-dir",
        testInstallDir,
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
      await program.parseAsync([
        "node",
        "nori-skillsets",
        "--non-interactive",
        "switch-skillset",
        "product-manager",
        "--install-dir",
        testInstallDir,
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
