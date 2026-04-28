/**
 * Tests for switch-skillset command
 * Tests that the CLI correctly delegates to shared agent operations
 */

import * as fs from "fs/promises";
import * as os from "os";
import { tmpdir } from "os";
import * as path from "path";

import { Command } from "commander";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  switchSkillset as switchSkillsetOp,
  captureExistingConfig,
} from "@/cli/features/agentOperations.js";
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
vi.mock("@/norijson/skillset.js", async (importOriginal) => {
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

// Mock agentOperations - shared functions that replaced agent methods
vi.mock("@/cli/features/agentOperations.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    switchSkillset: vi.fn().mockResolvedValue(undefined),
    detectLocalChanges: vi.fn().mockResolvedValue(null),
    captureExistingConfig: vi.fn().mockResolvedValue(undefined),
  };
});

describe("switchSkillset shared operation", () => {
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

    // Switch to profile-b using shared operation
    const agent = AgentRegistry.getInstance().get({ name: "claude-code" });
    // Call the real switchSkillset (not the mock) to verify it doesn't touch config
    const actualModule = await vi.importActual(
      "@/cli/features/agentOperations.js",
    );
    const realSwitchSkillset = (
      actualModule as { switchSkillset: typeof switchSkillsetOp }
    ).switchSkillset;
    await realSwitchSkillset({
      agent,
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

    // switchSkillset is already mocked via vi.mock of agentOperations

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
    // Mock detectLocalChanges to return changes for this test
    const { detectLocalChanges } =
      await import("@/cli/features/agentOperations.js");
    vi.mocked(detectLocalChanges).mockResolvedValueOnce({
      modified: ["skills/my-skill/SKILL.md"],
      added: [],
      deleted: [],
    });

    const program = new Command();
    program.exitOverride();
    program.configureOutput({ writeErr: () => undefined });
    program
      .option("-d, --install-dir <path>", "Custom installation directory")
      .option("-n, --non-interactive", "Run without interactive prompts")
      .option("-a, --agent <name>", "AI agent to use");

    registerSwitchSkillsetCommand({ program });

    // switchSkillset is already mocked via vi.mock of agentOperations

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
    expect(vi.mocked(switchSkillsetOp)).not.toHaveBeenCalled();
  });

  it("should proceed in non-interactive mode when --force is used with local changes", async () => {
    // Mock detectLocalChanges to return changes for this test
    const { detectLocalChanges } =
      await import("@/cli/features/agentOperations.js");
    vi.mocked(detectLocalChanges).mockResolvedValueOnce({
      modified: ["skills/my-skill/SKILL.md"],
      added: [],
      deleted: [],
    });

    const program = new Command();
    program.exitOverride();
    program.configureOutput({ writeErr: () => undefined });
    program
      .option("-d, --install-dir <path>", "Custom installation directory")
      .option("-n, --non-interactive", "Run without interactive prompts")
      .option("-a, --agent <name>", "AI agent to use");

    registerSwitchSkillsetCommand({ program });

    // switchSkillset is already mocked via vi.mock of agentOperations

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
    expect(vi.mocked(switchSkillsetOp)).toHaveBeenCalledWith(
      expect.objectContaining({
        installDir: testInstallDir,
        skillsetName: "product-manager",
      }),
    );
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

    // switchSkillset is already mocked via vi.mock of agentOperations

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
    expect(vi.mocked(switchSkillsetOp)).toHaveBeenCalledWith(
      expect.objectContaining({
        installDir: testInstallDir,
        skillsetName: "product-manager",
      }),
    );

    // installMain should have been called for each agent
    expect(mockInstallMain).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: "claude-code",
        silent: true,
      }),
    );
  });
});

describe("switch-skillset passes skillset name to installMain", () => {
  let testInstallDir: string;

  beforeEach(async () => {
    testInstallDir = await fs.mkdtemp(
      path.join(tmpdir(), "switch-skillset-skillset-arg-test-"),
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
    AgentRegistry.resetInstance();
    vi.restoreAllMocks();
  });

  it("should pass skillset name to installMain in non-interactive mode when no existing skillset is set", async () => {
    // Config has NO activeSkillset — reproduces the reported bug
    const configPath = path.join(testInstallDir, ".nori-config.json");
    await fs.writeFile(
      configPath,
      JSON.stringify({
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

    // switchSkillset is already mocked via vi.mock of agentOperations

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

    // installMain must receive the skillset name so it doesn't fail
    // when there's no existing skillset in config
    expect(mockInstallMain).toHaveBeenCalledWith(
      expect.objectContaining({
        skillset: "product-manager",
      }),
    );
  });

  it("should pass skillset name to installMain in interactive onExecuteSwitch when no existing skillset is set", async () => {
    // Config has NO activeSkillset — reproduces the reported bug for interactive path
    const configPath = path.join(testInstallDir, ".nori-config.json");
    await fs.writeFile(
      configPath,
      JSON.stringify({
        defaultAgents: ["claude-code"],
        installDir: testInstallDir,
      }),
    );

    // Capture and invoke the onExecuteSwitch callback
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

    // switchSkillset is already mocked via vi.mock of agentOperations

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

    // installMain must receive the skillset name so it doesn't fail
    // when there's no existing skillset in config
    expect(mockInstallMain).toHaveBeenCalledWith(
      expect.objectContaining({
        skillset: "product-manager",
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

    // switchSkillset is already mocked via vi.mock of agentOperations

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

    // switchSkillset is already mocked via vi.mock of agentOperations

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

    // switchSkillset is already mocked via vi.mock of agentOperations

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

    // captureExistingConfig is already mocked via vi.mock of agentOperations

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
    expect(vi.mocked(captureExistingConfig)).toHaveBeenCalledWith(
      expect.objectContaining({
        installDir: testInstallDir,
        skillsetName: "my-captured-config",
      }),
    );
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
      await fs.writeFile(path.join(dir, "AGENTS.md"), `# ${name}`);
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

    // switchSkillset is already mocked via vi.mock of agentOperations

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
    expect(vi.mocked(switchSkillsetOp)).toHaveBeenCalledWith(
      expect.objectContaining({
        installDir: testInstallDir,
        skillsetName: "product-manager",
      }),
    );
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

    // switchSkillset is already mocked via vi.mock of agentOperations

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

    // switchSkillset is already mocked via vi.mock of agentOperations

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

    // switchSkillset is already mocked via vi.mock of agentOperations

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
    expect(vi.mocked(switchSkillsetOp)).toHaveBeenCalled();
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

    // switchSkillset is already mocked via vi.mock of agentOperations

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

    // switchSkillset is already mocked via vi.mock of agentOperations

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

    // switchSkillset is already mocked via vi.mock of agentOperations

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

describe("onReadFileDiff subagent path mapping", () => {
  let testInstallDir: string;

  beforeEach(async () => {
    testInstallDir = await fs.realpath(
      await fs.mkdtemp(
        path.join(tmpdir(), "switch-skillset-readfilediff-test-"),
      ),
    );
    vi.mocked(os.homedir).mockReturnValue(testInstallDir);

    // Create basic directory structure
    const claudeDir = path.join(testInstallDir, ".claude");
    const agentsDir = path.join(claudeDir, "agents");
    const noriDir = path.join(testInstallDir, ".nori");
    const skillsetsDir = path.join(noriDir, "profiles");
    await fs.mkdir(agentsDir, { recursive: true });
    await fs.mkdir(skillsetsDir, { recursive: true });

    // Create skillset with nori.json
    const profileDir = path.join(skillsetsDir, "test-profile");
    await fs.mkdir(profileDir, { recursive: true });
    await fs.writeFile(
      path.join(profileDir, "nori.json"),
      JSON.stringify({ name: "test-profile", version: "1.0.0" }),
    );

    // Create config with active skillset
    const configPath = path.join(testInstallDir, ".nori-config.json");
    await fs.writeFile(
      configPath,
      JSON.stringify({
        activeSkillset: "test-profile",
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

  it("should map agents/foo.md to subagents/foo/SUBAGENT.md for directory-based subagents", async () => {
    const profileDir = path.join(
      testInstallDir,
      ".nori",
      "profiles",
      "test-profile",
    );
    const subagentDir = path.join(profileDir, "subagents", "my-agent");
    await fs.mkdir(subagentDir, { recursive: true });
    await fs.writeFile(
      path.join(subagentDir, "SUBAGENT.md"),
      "# Directory-based agent content",
    );

    // Create the installed agent file
    const agentsDir = path.join(testInstallDir, ".claude", "agents");
    await fs.writeFile(
      path.join(agentsDir, "my-agent.md"),
      "# Installed agent content",
    );

    // Capture callbacks from switchSkillsetFlow
    let capturedCallbacks: Record<string, unknown> = {};
    mockSwitchSkillsetFlow.mockImplementation(async (args) => {
      capturedCallbacks = (args as Record<string, unknown>).callbacks as Record<
        string,
        unknown
      >;
      return {
        agentName: "claude-code",
        skillsetName: "test-profile",
        statusMessage: "ok",
      };
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
        "test-profile",
      ]);
    } catch {
      // May throw due to exit
    }

    // Invoke the captured onReadFileDiff
    const onReadFileDiff = capturedCallbacks.onReadFileDiff as (args: {
      relativePath: string;
      installDir: string;
    }) => Promise<{ original: string; current: string } | null>;
    expect(onReadFileDiff).toBeDefined();

    const result = await onReadFileDiff({
      relativePath: "agents/my-agent.md",
      installDir: testInstallDir,
    });

    expect(result).not.toBeNull();
    expect(result!.original).toContain("# Directory-based agent content");
    expect(result!.current).toContain("# Installed agent content");
  });

  it("should map agents/foo.md to subagents/foo.md for flat subagents", async () => {
    const profileDir = path.join(
      testInstallDir,
      ".nori",
      "profiles",
      "test-profile",
    );
    const subagentsDir = path.join(profileDir, "subagents");
    await fs.mkdir(subagentsDir, { recursive: true });
    await fs.writeFile(
      path.join(subagentsDir, "simple-agent.md"),
      "# Flat subagent content",
    );

    // Create the installed agent file
    const agentsDir = path.join(testInstallDir, ".claude", "agents");
    await fs.writeFile(
      path.join(agentsDir, "simple-agent.md"),
      "# Installed flat content",
    );

    let capturedCallbacks: Record<string, unknown> = {};
    mockSwitchSkillsetFlow.mockImplementation(async (args) => {
      capturedCallbacks = (args as Record<string, unknown>).callbacks as Record<
        string,
        unknown
      >;
      return {
        agentName: "claude-code",
        skillsetName: "test-profile",
        statusMessage: "ok",
      };
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
        "test-profile",
      ]);
    } catch {
      // May throw due to exit
    }

    const onReadFileDiff = capturedCallbacks.onReadFileDiff as (args: {
      relativePath: string;
      installDir: string;
    }) => Promise<{ original: string; current: string } | null>;

    const result = await onReadFileDiff({
      relativePath: "agents/simple-agent.md",
      installDir: testInstallDir,
    });

    expect(result).not.toBeNull();
    expect(result!.original).toContain("# Flat subagent content");
    expect(result!.current).toContain("# Installed flat content");
  });

  it("should map agents/foo.toml to subagents/foo.md for Codex-installed markdown-backed subagents", async () => {
    const profileDir = path.join(
      testInstallDir,
      ".nori",
      "profiles",
      "test-profile",
    );
    const subagentsDir = path.join(profileDir, "subagents");
    await fs.mkdir(subagentsDir, { recursive: true });
    await fs.writeFile(
      path.join(subagentsDir, "codex-agent.md"),
      "---\nname: codex-agent\ndescription: Codex-backed agent\n---\n\n# Markdown-backed agent content",
    );

    const agentsDir = path.join(testInstallDir, ".claude", "agents");
    await fs.writeFile(
      path.join(agentsDir, "codex-agent.toml"),
      'name = "codex-agent"',
    );

    let capturedCallbacks: Record<string, unknown> = {};
    mockSwitchSkillsetFlow.mockImplementation(async (args) => {
      capturedCallbacks = (args as Record<string, unknown>).callbacks as Record<
        string,
        unknown
      >;
      return {
        agentName: "claude-code",
        skillsetName: "test-profile",
        statusMessage: "ok",
      };
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
        "test-profile",
      ]);
    } catch {
      // May throw due to exit
    }

    const onReadFileDiff = capturedCallbacks.onReadFileDiff as (args: {
      relativePath: string;
      installDir: string;
    }) => Promise<{ original: string; current: string } | null>;

    const result = await onReadFileDiff({
      relativePath: "agents/codex-agent.toml",
      installDir: testInstallDir,
    });

    expect(result).not.toBeNull();
    expect(result!.original).toContain("# Markdown-backed agent content");
    expect(result!.current).toContain('name = "codex-agent"');
  });

  it("should return null when neither flat nor directory-based source exists", async () => {
    // Create the installed agent file with no matching source
    const agentsDir = path.join(testInstallDir, ".claude", "agents");
    await fs.writeFile(
      path.join(agentsDir, "orphan-agent.md"),
      "# Orphan content",
    );

    // Create subagents dir (empty)
    const profileDir = path.join(
      testInstallDir,
      ".nori",
      "profiles",
      "test-profile",
    );
    await fs.mkdir(path.join(profileDir, "subagents"), { recursive: true });

    let capturedCallbacks: Record<string, unknown> = {};
    mockSwitchSkillsetFlow.mockImplementation(async (args) => {
      capturedCallbacks = (args as Record<string, unknown>).callbacks as Record<
        string,
        unknown
      >;
      return {
        agentName: "claude-code",
        skillsetName: "test-profile",
        statusMessage: "ok",
      };
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
        "test-profile",
      ]);
    } catch {
      // May throw due to exit
    }

    const onReadFileDiff = capturedCallbacks.onReadFileDiff as (args: {
      relativePath: string;
      installDir: string;
    }) => Promise<{ original: string; current: string } | null>;

    const result = await onReadFileDiff({
      relativePath: "agents/orphan-agent.md",
      installDir: testInstallDir,
    });

    expect(result).toBeNull();
  });
});
