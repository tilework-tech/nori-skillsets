/**
 * Tests for switch-profile command
 * Tests that the CLI correctly delegates to agent methods
 */

import * as fs from "fs/promises";
import { tmpdir } from "os";
import * as path from "path";

import { Command } from "commander";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { AgentRegistry } from "@/cli/features/agentRegistry.js";
import { promptUser } from "@/cli/prompt.js";

import { registerSwitchProfileCommand } from "./profiles.js";

// Mock install to avoid side effects - track calls for verification
const mockInstallMain = vi.fn().mockResolvedValue(undefined);
vi.mock("@/cli/commands/install/install.js", () => ({
  main: mockInstallMain,
}));

// Mock promptUser for interactive tests
vi.mock("@/cli/prompt.js", () => ({
  promptUser: vi.fn(),
}));

describe("agent.listProfiles", () => {
  let testInstallDir: string;

  beforeEach(async () => {
    testInstallDir = await fs.mkdtemp(path.join(tmpdir(), "profiles-test-"));
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

  it("should list all installed profiles", async () => {
    const profilesDir = path.join(testInstallDir, ".nori", "profiles");
    await fs.mkdir(profilesDir, { recursive: true });

    // Create user-facing profiles
    for (const name of ["amol", "senior-swe"]) {
      const dir = path.join(profilesDir, name);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, "CLAUDE.md"), `# ${name}`);
      await fs.writeFile(
        path.join(dir, "profile.json"),
        JSON.stringify({ extends: "_base", name, description: "Test" }),
      );
    }

    const agent = AgentRegistry.getInstance().get({ name: "claude-code" });
    const profiles = await agent.listProfiles({ installDir: testInstallDir });

    expect(profiles).toContain("amol");
    expect(profiles).toContain("senior-swe");
  });
});

describe("agent.switchProfile", () => {
  let testInstallDir: string;

  beforeEach(async () => {
    testInstallDir = await fs.mkdtemp(path.join(tmpdir(), "switch-test-"));
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

  it("should preserve registryAuths when switching profiles", async () => {
    // Create profiles directory with test profiles
    const profilesDir = path.join(testInstallDir, ".nori", "profiles");
    await fs.mkdir(profilesDir, { recursive: true });

    for (const name of ["profile-a", "profile-b"]) {
      const dir = path.join(profilesDir, name);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, "CLAUDE.md"), `# ${name}`);
    }

    // Create initial config with registryAuths
    const configPath = path.join(testInstallDir, ".nori-config.json");
    const initialConfig = {
      profile: { baseProfile: "profile-a" },
      registryAuths: [
        {
          username: "test@example.com",
          password: "secret123",
          registryUrl: "https://private.registry.com",
        },
      ],
      sendSessionTranscript: "enabled",
    };
    await fs.writeFile(configPath, JSON.stringify(initialConfig, null, 2));

    // Switch to profile-b using agent method
    const agent = AgentRegistry.getInstance().get({ name: "claude-code" });
    await agent.switchProfile({
      installDir: testInstallDir,
      profileName: "profile-b",
    });

    // Verify registryAuths was preserved
    const updatedConfig = JSON.parse(await fs.readFile(configPath, "utf-8"));
    expect(updatedConfig.agents?.["claude-code"]?.profile?.baseProfile).toBe(
      "profile-b",
    );
    expect(updatedConfig.registryAuths).toEqual([
      {
        username: "test@example.com",
        password: "secret123",
        registryUrl: "https://private.registry.com",
      },
    ]);
  });

  it("should preserve version when switching profiles for claude-code", async () => {
    // Create profiles directory with test profiles
    const profilesDir = path.join(testInstallDir, ".nori", "profiles");
    await fs.mkdir(profilesDir, { recursive: true });

    for (const name of ["profile-a", "profile-b"]) {
      const dir = path.join(profilesDir, name);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, "CLAUDE.md"), `# ${name}`);
    }

    // Create initial config with version
    const configPath = path.join(testInstallDir, ".nori-config.json");
    const initialConfig = {
      agents: {
        "claude-code": { profile: { baseProfile: "profile-a" } },
      },
      version: "v19.0.0",
    };
    await fs.writeFile(configPath, JSON.stringify(initialConfig, null, 2));

    // Switch to profile-b using agent method
    const agent = AgentRegistry.getInstance().get({ name: "claude-code" });
    await agent.switchProfile({
      installDir: testInstallDir,
      profileName: "profile-b",
    });

    // Verify version was preserved
    const updatedConfig = JSON.parse(await fs.readFile(configPath, "utf-8"));
    expect(updatedConfig.agents?.["claude-code"]?.profile?.baseProfile).toBe(
      "profile-b",
    );
    expect(updatedConfig.version).toBe("v19.0.0");
  });

  it("should preserve version when switching profiles for cursor-agent", async () => {
    // Create cursor profiles directory with test profiles
    const profilesDir = path.join(testInstallDir, ".cursor", "profiles");
    await fs.mkdir(profilesDir, { recursive: true });

    for (const name of ["profile-a", "profile-b"]) {
      const dir = path.join(profilesDir, name);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, "AGENTS.md"), `# ${name}`);
    }

    // Create initial config with version
    const configPath = path.join(testInstallDir, ".nori-config.json");
    const initialConfig = {
      agents: {
        "cursor-agent": { profile: { baseProfile: "profile-a" } },
      },
      version: "v19.0.0",
    };
    await fs.writeFile(configPath, JSON.stringify(initialConfig, null, 2));

    // Switch to profile-b using agent method
    const agent = AgentRegistry.getInstance().get({ name: "cursor-agent" });
    await agent.switchProfile({
      installDir: testInstallDir,
      profileName: "profile-b",
    });

    // Verify version was preserved
    const updatedConfig = JSON.parse(await fs.readFile(configPath, "utf-8"));
    expect(updatedConfig.agents?.["cursor-agent"]?.profile?.baseProfile).toBe(
      "profile-b",
    );
    expect(updatedConfig.version).toBe("v19.0.0");
  });

  it("should preserve refreshToken when switching profiles for claude-code", async () => {
    // Create profiles directory with test profiles
    const profilesDir = path.join(testInstallDir, ".nori", "profiles");
    await fs.mkdir(profilesDir, { recursive: true });

    for (const name of ["profile-a", "profile-b"]) {
      const dir = path.join(profilesDir, name);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, "CLAUDE.md"), `# ${name}`);
    }

    // Create initial config with auth containing refreshToken
    const configPath = path.join(testInstallDir, ".nori-config.json");
    const initialConfig = {
      agents: {
        "claude-code": { profile: { baseProfile: "profile-a" } },
      },
      auth: {
        username: "test@example.com",
        refreshToken: "test-refresh-token-12345",
        organizationUrl: "https://org.example.com",
      },
    };
    await fs.writeFile(configPath, JSON.stringify(initialConfig, null, 2));

    // Switch to profile-b using agent method
    const agent = AgentRegistry.getInstance().get({ name: "claude-code" });
    await agent.switchProfile({
      installDir: testInstallDir,
      profileName: "profile-b",
    });

    // Verify refreshToken was preserved
    const updatedConfig = JSON.parse(await fs.readFile(configPath, "utf-8"));
    expect(updatedConfig.agents?.["claude-code"]?.profile?.baseProfile).toBe(
      "profile-b",
    );
    expect(updatedConfig.auth?.refreshToken).toBe("test-refresh-token-12345");
  });

  it("should preserve refreshToken when switching profiles for cursor-agent", async () => {
    // Create cursor profiles directory with test profiles
    const profilesDir = path.join(testInstallDir, ".cursor", "profiles");
    await fs.mkdir(profilesDir, { recursive: true });

    for (const name of ["profile-a", "profile-b"]) {
      const dir = path.join(profilesDir, name);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, "AGENTS.md"), `# ${name}`);
    }

    // Create initial config with auth containing refreshToken
    const configPath = path.join(testInstallDir, ".nori-config.json");
    const initialConfig = {
      agents: {
        "cursor-agent": { profile: { baseProfile: "profile-a" } },
      },
      auth: {
        username: "test@example.com",
        refreshToken: "test-refresh-token-12345",
        organizationUrl: "https://org.example.com",
      },
    };
    await fs.writeFile(configPath, JSON.stringify(initialConfig, null, 2));

    // Switch to profile-b using agent method
    const agent = AgentRegistry.getInstance().get({ name: "cursor-agent" });
    await agent.switchProfile({
      installDir: testInstallDir,
      profileName: "profile-b",
    });

    // Verify refreshToken was preserved
    const updatedConfig = JSON.parse(await fs.readFile(configPath, "utf-8"));
    expect(updatedConfig.agents?.["cursor-agent"]?.profile?.baseProfile).toBe(
      "profile-b",
    );
    expect(updatedConfig.auth?.refreshToken).toBe("test-refresh-token-12345");
  });
});

describe("registerSwitchProfileCommand", () => {
  let testInstallDir: string;

  beforeEach(async () => {
    testInstallDir = await fs.mkdtemp(
      path.join(tmpdir(), "switch-profile-cmd-test-"),
    );
    const testClaudeDir = path.join(testInstallDir, ".claude");
    const testNoriDir = path.join(testInstallDir, ".nori");
    await fs.mkdir(testClaudeDir, { recursive: true });
    await fs.mkdir(testNoriDir, { recursive: true });

    // Create profiles directory with test profiles
    const profilesDir = path.join(testNoriDir, "profiles");
    await fs.mkdir(profilesDir, { recursive: true });
    for (const name of ["senior-swe", "product-manager"]) {
      const dir = path.join(profilesDir, name);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, "CLAUDE.md"), `# ${name}`);
    }

    AgentRegistry.resetInstance();
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

    registerSwitchProfileCommand({ program });

    // This should NOT throw "unknown option '--agent'" when --agent comes after the subcommand
    // Parse with --agent AFTER the subcommand (the bug case)
    let parseError: Error | null = null;
    try {
      await program.parseAsync([
        "node",
        "nori-ai",
        "switch-profile",
        "senior-swe",
        "--agent",
        "cursor-agent",
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

  it("should use the agent specified by --agent flag", async () => {
    // Create cursor profiles directory
    const cursorDir = path.join(testInstallDir, ".cursor");
    const cursorProfilesDir = path.join(cursorDir, "profiles");
    await fs.mkdir(cursorProfilesDir, { recursive: true });
    for (const name of ["senior-swe"]) {
      const dir = path.join(cursorProfilesDir, name);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, "AGENTS.md"), `# ${name}`);
    }

    // Create config with cursor-agent as installed agent
    const configPath = path.join(testInstallDir, ".nori-config.json");
    await fs.writeFile(
      configPath,
      JSON.stringify({
        agents: {
          "cursor-agent": { profile: { baseProfile: "senior-swe" } },
        },
        installDir: testInstallDir,
      }),
    );

    const program = new Command();
    program.exitOverride();
    let capturedErr = "";
    program.configureOutput({
      writeErr: (str) => {
        capturedErr += str;
      },
    });
    program
      .option("-d, --install-dir <path>", "Custom installation directory")
      .option("-n, --non-interactive", "Run without interactive prompts")
      .option("-a, --agent <name>", "AI agent to use", "claude-code");

    registerSwitchProfileCommand({ program });

    // Mock confirmation prompt to return "y"
    vi.mocked(promptUser).mockResolvedValueOnce("y");

    // Mock the cursor-agent's switchProfile to track if it was called
    const cursorAgent = AgentRegistry.getInstance().get({
      name: "cursor-agent",
    });
    const switchProfileSpy = vi
      .spyOn(cursorAgent, "switchProfile")
      .mockResolvedValue(undefined);

    let caughtError: Error | null = null;
    try {
      // Note: from: "node" means first two args are node and script path
      await program.parseAsync([
        "node",
        "nori-ai",
        "switch-profile",
        "senior-swe",
        "--agent",
        "cursor-agent",
        "--install-dir",
        testInstallDir,
      ]);
    } catch (err) {
      caughtError = err as Error;
    }

    // Log any error for debugging
    if (caughtError) {
      console.log("Caught error:", caughtError.message);
    }
    if (capturedErr) {
      console.log("Captured stderr:", capturedErr);
    }

    // Verify cursor-agent's switchProfile was called
    expect(switchProfileSpy).toHaveBeenCalledWith({
      installDir: testInstallDir,
      profileName: "senior-swe",
    });
  });

  it("should auto-select the only installed agent when --agent not provided", async () => {
    // Create config with only cursor-agent installed
    const configPath = path.join(testInstallDir, ".nori-config.json");
    await fs.writeFile(
      configPath,
      JSON.stringify({
        agents: {
          "cursor-agent": { profile: { baseProfile: "senior-swe" } },
        },
        installDir: testInstallDir,
      }),
    );

    // Create cursor profiles directory
    const cursorDir = path.join(testInstallDir, ".cursor");
    const cursorProfilesDir = path.join(cursorDir, "profiles");
    await fs.mkdir(cursorProfilesDir, { recursive: true });
    for (const name of ["senior-swe"]) {
      const dir = path.join(cursorProfilesDir, name);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, "AGENTS.md"), `# ${name}`);
    }

    const program = new Command();
    program.exitOverride();
    program.configureOutput({ writeErr: () => undefined });
    program
      .option("-d, --install-dir <path>", "Custom installation directory")
      .option("-n, --non-interactive", "Run without interactive prompts")
      .option("-a, --agent <name>", "AI agent to use");

    registerSwitchProfileCommand({ program });

    // Mock confirmation prompt to return "y"
    vi.mocked(promptUser).mockResolvedValueOnce("y");

    // Mock cursor-agent's switchProfile
    const cursorAgent = AgentRegistry.getInstance().get({
      name: "cursor-agent",
    });
    const switchProfileSpy = vi
      .spyOn(cursorAgent, "switchProfile")
      .mockResolvedValue(undefined);

    try {
      await program.parseAsync([
        "node",
        "nori-ai",
        "switch-profile",
        "senior-swe",
        "--install-dir",
        testInstallDir,
      ]);
    } catch {
      // May throw due to exit
    }

    // When only one agent is installed and no --agent flag, use that agent
    expect(switchProfileSpy).toHaveBeenCalledWith({
      installDir: testInstallDir,
      profileName: "senior-swe",
    });
  });

  it("should error in non-interactive mode when multiple agents installed and no --agent provided", async () => {
    // Create config with multiple agents installed
    const configPath = path.join(testInstallDir, ".nori-config.json");
    await fs.writeFile(
      configPath,
      JSON.stringify({
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
          "cursor-agent": { profile: { baseProfile: "senior-swe" } },
        },
        installDir: testInstallDir,
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

    registerSwitchProfileCommand({ program });

    let thrownError: Error | null = null;
    try {
      await program.parseAsync([
        "node",
        "nori-ai",
        "--non-interactive",
        "switch-profile",
        "senior-swe",
        "--install-dir",
        testInstallDir,
      ]);
    } catch (err) {
      thrownError = err as Error;
    }

    // Should error because multiple agents are installed and no --agent specified in non-interactive mode
    expect(thrownError).not.toBeNull();
    // The error should mention needing to specify --agent
    expect(
      errorMessage.includes("--agent") ||
        thrownError?.message.includes("agent"),
    ).toBe(true);
  });

  it("should call installMain with silent: true", async () => {
    // Create config with claude-code installed
    const configPath = path.join(testInstallDir, ".nori-config.json");
    await fs.writeFile(
      configPath,
      JSON.stringify({
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
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

    registerSwitchProfileCommand({ program });

    // Reset mock to track this specific call
    mockInstallMain.mockClear();

    // Mock confirmation prompt to return "y"
    vi.mocked(promptUser).mockResolvedValueOnce("y");

    // Mock claude-code's switchProfile
    const claudeAgent = AgentRegistry.getInstance().get({
      name: "claude-code",
    });
    vi.spyOn(claudeAgent, "switchProfile").mockResolvedValue(undefined);

    try {
      await program.parseAsync([
        "node",
        "nori-ai",
        "switch-profile",
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
        skipUninstall: true,
      }),
    );
  });

  it("should prompt user to select agent when multiple agents installed in interactive mode", async () => {
    // Create config with multiple agents installed
    const configPath = path.join(testInstallDir, ".nori-config.json");
    await fs.writeFile(
      configPath,
      JSON.stringify({
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
          "cursor-agent": { profile: { baseProfile: "senior-swe" } },
        },
        installDir: testInstallDir,
      }),
    );

    // Create cursor profiles directory
    const cursorDir = path.join(testInstallDir, ".cursor");
    const cursorProfilesDir = path.join(cursorDir, "profiles");
    await fs.mkdir(cursorProfilesDir, { recursive: true });
    for (const name of ["senior-swe"]) {
      const dir = path.join(cursorProfilesDir, name);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, "AGENTS.md"), `# ${name}`);
    }

    const program = new Command();
    program.exitOverride();
    program.configureOutput({ writeErr: () => undefined });
    program
      .option("-d, --install-dir <path>", "Custom installation directory")
      .option("-n, --non-interactive", "Run without interactive prompts")
      .option("-a, --agent <name>", "AI agent to use");

    registerSwitchProfileCommand({ program });

    // Mock user selecting cursor-agent (option 2), then confirming with "y"
    vi.mocked(promptUser)
      .mockResolvedValueOnce("2") // Agent selection
      .mockResolvedValueOnce("y"); // Confirmation

    // Mock cursor-agent's switchProfile
    const cursorAgent = AgentRegistry.getInstance().get({
      name: "cursor-agent",
    });
    const switchProfileSpy = vi
      .spyOn(cursorAgent, "switchProfile")
      .mockResolvedValue(undefined);

    try {
      await program.parseAsync([
        "node",
        "nori-ai",
        "switch-profile",
        "senior-swe",
        "--install-dir",
        testInstallDir,
      ]);
    } catch {
      // May throw due to exit
    }

    // Verify promptUser was called (for agent selection and confirmation)
    expect(promptUser).toHaveBeenCalled();

    // Verify cursor-agent's switchProfile was called (user selected option 2)
    expect(switchProfileSpy).toHaveBeenCalledWith({
      installDir: testInstallDir,
      profileName: "senior-swe",
    });
  });
});

describe("switch-profile confirmation", () => {
  let testInstallDir: string;

  beforeEach(async () => {
    testInstallDir = await fs.mkdtemp(
      path.join(tmpdir(), "switch-profile-confirm-test-"),
    );
    const testClaudeDir = path.join(testInstallDir, ".claude");
    const testNoriDir = path.join(testInstallDir, ".nori");
    await fs.mkdir(testClaudeDir, { recursive: true });
    await fs.mkdir(testNoriDir, { recursive: true });

    // Create profiles directory with test profiles
    const profilesDir = path.join(testNoriDir, "profiles");
    await fs.mkdir(profilesDir, { recursive: true });
    for (const name of ["senior-swe", "product-manager"]) {
      const dir = path.join(profilesDir, name);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, "CLAUDE.md"), `# ${name}`);
    }

    AgentRegistry.resetInstance();
    vi.mocked(promptUser).mockReset();
  });

  afterEach(async () => {
    if (testInstallDir) {
      await fs.rm(testInstallDir, { recursive: true, force: true });
    }
    AgentRegistry.resetInstance();
    vi.restoreAllMocks();
  });

  it("should show confirmation prompt with install dir, agent, current profile, and new profile in interactive mode", async () => {
    // Create config with current profile
    const configPath = path.join(testInstallDir, ".nori-config.json");
    await fs.writeFile(
      configPath,
      JSON.stringify({
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
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

    registerSwitchProfileCommand({ program });

    // Mock confirmation prompt to return "y"
    vi.mocked(promptUser).mockResolvedValueOnce("y");

    // Mock switchProfile
    const claudeAgent = AgentRegistry.getInstance().get({
      name: "claude-code",
    });
    const switchProfileSpy = vi
      .spyOn(claudeAgent, "switchProfile")
      .mockResolvedValue(undefined);

    try {
      await program.parseAsync([
        "node",
        "nori-ai",
        "switch-profile",
        "product-manager",
        "--install-dir",
        testInstallDir,
      ]);
    } catch {
      // May throw due to exit
    }

    // Verify promptUser was called for confirmation
    expect(promptUser).toHaveBeenCalled();

    // The prompt should contain key information
    const promptCall = vi.mocked(promptUser).mock.calls[0][0];
    expect(promptCall.prompt).toContain("y/n");

    // switchProfile should have been called since user confirmed
    expect(switchProfileSpy).toHaveBeenCalledWith({
      installDir: testInstallDir,
      profileName: "product-manager",
    });
  });

  it("should cancel operation when user declines confirmation", async () => {
    // Create config with current profile
    const configPath = path.join(testInstallDir, ".nori-config.json");
    await fs.writeFile(
      configPath,
      JSON.stringify({
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
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

    registerSwitchProfileCommand({ program });

    // Mock confirmation prompt to return "n"
    vi.mocked(promptUser).mockResolvedValueOnce("n");

    // Mock switchProfile to track if it was called
    const claudeAgent = AgentRegistry.getInstance().get({
      name: "claude-code",
    });
    const switchProfileSpy = vi
      .spyOn(claudeAgent, "switchProfile")
      .mockResolvedValue(undefined);

    try {
      await program.parseAsync([
        "node",
        "nori-ai",
        "switch-profile",
        "product-manager",
        "--install-dir",
        testInstallDir,
      ]);
    } catch {
      // May throw due to exit
    }

    // switchProfile should NOT have been called since user declined
    expect(switchProfileSpy).not.toHaveBeenCalled();
  });

  it("should skip confirmation prompt in non-interactive mode", async () => {
    // Create config with current profile
    const configPath = path.join(testInstallDir, ".nori-config.json");
    await fs.writeFile(
      configPath,
      JSON.stringify({
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
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

    registerSwitchProfileCommand({ program });

    // Mock switchProfile
    const claudeAgent = AgentRegistry.getInstance().get({
      name: "claude-code",
    });
    const switchProfileSpy = vi
      .spyOn(claudeAgent, "switchProfile")
      .mockResolvedValue(undefined);

    try {
      await program.parseAsync([
        "node",
        "nori-ai",
        "--non-interactive",
        "switch-profile",
        "product-manager",
        "--install-dir",
        testInstallDir,
      ]);
    } catch {
      // May throw due to exit
    }

    // promptUser should NOT have been called in non-interactive mode
    expect(promptUser).not.toHaveBeenCalled();

    // switchProfile should proceed without confirmation
    expect(switchProfileSpy).toHaveBeenCalledWith({
      installDir: testInstallDir,
      profileName: "product-manager",
    });
  });

  it("should show specified agent display name in confirmation prompt", async () => {
    // Create cursor profiles directory
    const cursorDir = path.join(testInstallDir, ".cursor");
    const cursorProfilesDir = path.join(cursorDir, "profiles");
    await fs.mkdir(cursorProfilesDir, { recursive: true });
    for (const name of ["senior-swe", "product-manager"]) {
      const dir = path.join(cursorProfilesDir, name);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, "AGENTS.md"), `# ${name}`);
    }

    // Create config with cursor-agent
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
    let capturedOutput = "";
    // Capture info output to verify agent name is displayed
    const originalConsoleLog = console.log;
    console.log = (msg: string) => {
      capturedOutput += msg + "\n";
    };

    program.configureOutput({ writeErr: () => undefined });
    program
      .option("-d, --install-dir <path>", "Custom installation directory")
      .option("-n, --non-interactive", "Run without interactive prompts")
      .option("-a, --agent <name>", "AI agent to use");

    registerSwitchProfileCommand({ program });

    // Mock confirmation prompt to return "y"
    vi.mocked(promptUser).mockResolvedValueOnce("y");

    // Mock switchProfile
    const cursorAgent = AgentRegistry.getInstance().get({
      name: "cursor-agent",
    });
    const switchProfileSpy = vi
      .spyOn(cursorAgent, "switchProfile")
      .mockResolvedValue(undefined);

    try {
      await program.parseAsync([
        "node",
        "nori-ai",
        "switch-profile",
        "product-manager",
        "--agent",
        "cursor-agent",
        "--install-dir",
        testInstallDir,
      ]);
    } catch {
      // May throw due to exit
    } finally {
      console.log = originalConsoleLog;
    }

    // The output should mention cursor-agent or Cursor Agent
    expect(
      capturedOutput.includes("cursor-agent") ||
        capturedOutput.includes("Cursor Agent"),
    ).toBe(true);

    // switchProfile should have been called
    expect(switchProfileSpy).toHaveBeenCalled();
  });
});

describe("switch-profile skipBuiltinProfiles", () => {
  let testInstallDir: string;

  beforeEach(async () => {
    testInstallDir = await fs.mkdtemp(
      path.join(tmpdir(), "switch-profile-skip-builtin-test-"),
    );
    const testClaudeDir = path.join(testInstallDir, ".claude");
    const testNoriDir = path.join(testInstallDir, ".nori");
    await fs.mkdir(testClaudeDir, { recursive: true });
    await fs.mkdir(testNoriDir, { recursive: true });

    // Create profiles directory with test profiles
    const profilesDir = path.join(testNoriDir, "profiles");
    await fs.mkdir(profilesDir, { recursive: true });
    for (const name of ["senior-swe", "custom-profile"]) {
      const dir = path.join(profilesDir, name);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, "CLAUDE.md"), `# ${name}`);
    }

    AgentRegistry.resetInstance();
    vi.mocked(promptUser).mockReset();
    mockInstallMain.mockClear();
  });

  afterEach(async () => {
    if (testInstallDir) {
      await fs.rm(testInstallDir, { recursive: true, force: true });
    }
    AgentRegistry.resetInstance();
    vi.restoreAllMocks();
  });

  it("should call installMain with skipBuiltinProfiles: true to prevent installing all built-in profiles", async () => {
    // Create config with claude-code installed
    const configPath = path.join(testInstallDir, ".nori-config.json");
    await fs.writeFile(
      configPath,
      JSON.stringify({
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
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

    registerSwitchProfileCommand({ program });

    // Mock claude-code's switchProfile
    const claudeAgent = AgentRegistry.getInstance().get({
      name: "claude-code",
    });
    vi.spyOn(claudeAgent, "switchProfile").mockResolvedValue(undefined);

    try {
      await program.parseAsync([
        "node",
        "nori-ai",
        "--non-interactive",
        "switch-profile",
        "custom-profile",
        "--install-dir",
        testInstallDir,
      ]);
    } catch {
      // May throw due to exit
    }

    // Verify installMain was called with skipBuiltinProfiles: true
    // This is the key assertion - switch-profile should NOT cause all built-in profiles to be installed
    expect(mockInstallMain).toHaveBeenCalledWith(
      expect.objectContaining({
        skipBuiltinProfiles: true,
        skipUninstall: true,
        silent: true,
      }),
    );
  });
});

describe("switch-profile getInstallDirs auto-detection", () => {
  let testInstallDir: string;
  let originalCwd: string;

  beforeEach(async () => {
    originalCwd = process.cwd();
    // Use realpath to resolve symlinks (macOS /var -> /private/var)
    testInstallDir = await fs.realpath(
      await fs.mkdtemp(path.join(tmpdir(), "switch-profile-autodetect-test-")),
    );

    // Create profiles directory with test profiles
    const noriDir = path.join(testInstallDir, ".nori");
    const profilesDir = path.join(noriDir, "profiles");
    await fs.mkdir(profilesDir, { recursive: true });
    for (const name of ["senior-swe", "product-manager"]) {
      const dir = path.join(profilesDir, name);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, "CLAUDE.md"), `# ${name}`);
    }

    // Create config file to mark this as a Nori installation
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
    vi.mocked(promptUser).mockReset();
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
    // Change to the installation directory
    process.chdir(testInstallDir);

    const program = new Command();
    program.exitOverride();
    program.configureOutput({ writeErr: () => undefined });
    program
      .option("-d, --install-dir <path>", "Custom installation directory")
      .option("-n, --non-interactive", "Run without interactive prompts")
      .option("-a, --agent <name>", "AI agent to use");

    registerSwitchProfileCommand({ program });

    // Mock confirmation prompt to return "y"
    vi.mocked(promptUser).mockResolvedValueOnce("y");

    // Mock switchProfile to track calls
    const claudeAgent = AgentRegistry.getInstance().get({
      name: "claude-code",
    });
    const switchProfileSpy = vi
      .spyOn(claudeAgent, "switchProfile")
      .mockResolvedValue(undefined);

    try {
      // Note: NO --install-dir flag - should auto-detect from cwd
      await program.parseAsync([
        "node",
        "nori-ai",
        "switch-profile",
        "product-manager",
      ]);
    } catch {
      // May throw due to exit
    }

    // Should detect installation in current directory and use it
    expect(switchProfileSpy).toHaveBeenCalledWith({
      installDir: testInstallDir,
      profileName: "product-manager",
    });
  });

  it("should auto-detect installation in parent directory when running from subdirectory", async () => {
    // Create a subdirectory to run from
    const subDir = path.join(testInstallDir, "src", "components");
    await fs.mkdir(subDir, { recursive: true });

    // Change to the subdirectory
    process.chdir(subDir);

    const program = new Command();
    program.exitOverride();
    program.configureOutput({ writeErr: () => undefined });
    program
      .option("-d, --install-dir <path>", "Custom installation directory")
      .option("-n, --non-interactive", "Run without interactive prompts")
      .option("-a, --agent <name>", "AI agent to use");

    registerSwitchProfileCommand({ program });

    // Mock confirmation prompt to return "y"
    vi.mocked(promptUser).mockResolvedValueOnce("y");

    // Mock switchProfile to track calls
    const claudeAgent = AgentRegistry.getInstance().get({
      name: "claude-code",
    });
    const switchProfileSpy = vi
      .spyOn(claudeAgent, "switchProfile")
      .mockResolvedValue(undefined);

    try {
      // Note: NO --install-dir flag - should traverse up and find installation
      await program.parseAsync([
        "node",
        "nori-ai",
        "switch-profile",
        "product-manager",
      ]);
    } catch {
      // May throw due to exit
    }

    // Should traverse up and find installation in parent directory
    expect(switchProfileSpy).toHaveBeenCalledWith({
      installDir: testInstallDir,
      profileName: "product-manager",
    });
  });

  it("should error when no installation found in current or ancestor directories", async () => {
    // Create a directory WITHOUT a Nori installation
    const emptyDir = await fs.mkdtemp(
      path.join(tmpdir(), "switch-profile-empty-test-"),
    );

    try {
      // Change to the empty directory
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

      registerSwitchProfileCommand({ program });

      let thrownError: Error | null = null;
      try {
        // Note: NO --install-dir flag - should fail to find any installation
        await program.parseAsync([
          "node",
          "nori-ai",
          "switch-profile",
          "product-manager",
        ]);
      } catch (err) {
        thrownError = err as Error;
      }

      // Should error because no installation found
      expect(thrownError).not.toBeNull();
      // Error message should mention no installation found
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
