/**
 * Tests for uninstall idempotency
 * Verifies runUninstall can be called multiple times safely
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { configLoader } from "@/cli/features/config/loader.js";
import { promptUser } from "@/cli/prompt.js";

import type { AgentName } from "@/cli/features/agentRegistry.js";

// Mock modules - initialize with temp values
let mockClaudeDir = "/tmp/test-claude";
let mockConfigPath = "/tmp/test-config.json";

vi.mock("@/cli/features/claude-code/paths.js", () => ({
  getClaudeDir: () => mockClaudeDir,
  getClaudeSettingsFile: () => path.join(mockClaudeDir, "settings.json"),
  getClaudeHomeDir: () => mockClaudeDir,
  getClaudeHomeSettingsFile: () => path.join(mockClaudeDir, "settings.json"),
  getClaudeAgentsDir: () => path.join(mockClaudeDir, "agents"),
  getClaudeCommandsDir: () => path.join(mockClaudeDir, "commands"),
  getClaudeMdFile: () => path.join(mockClaudeDir, "CLAUDE.md"),
  getClaudeSkillsDir: () => path.join(mockClaudeDir, "skills"),
  getClaudeProfilesDir: () => path.join(mockClaudeDir, "profiles"),
}));

let mockLoadedConfig: any = null;

vi.mock("@/cli/config.js", async () => {
  const actual: any = await vi.importActual("@/cli/config.js");
  return {
    ...actual,
    getConfigPath: (args: { installDir: string }) => {
      // For the first describe block tests, use mockConfigPath
      // For ancestor tests, use real path
      if (args.installDir.includes("uninstall-ancestor-")) {
        return path.join(args.installDir, ".nori-config.json");
      }
      return mockConfigPath;
    },
    loadConfig: async (args: { installDir: string }) => {
      // For ancestor tests, load from real filesystem
      if (args.installDir.includes("uninstall-ancestor-")) {
        const configPath = path.join(args.installDir, ".nori-config.json");
        try {
          const content = await fs.readFile(configPath, "utf-8");
          const config = JSON.parse(content);
          return {
            auth: config.username
              ? {
                  username: config.username,
                  password: config.password,
                  organizationUrl: config.organizationUrl,
                }
              : null,
            installDir: args.installDir,
          };
        } catch {
          return null;
        }
      }
      // For old tests, use mock but add installDir from args
      if (mockLoadedConfig != null) {
        return { ...mockLoadedConfig, installDir: args.installDir };
      }
      return null;
    },
  };
});

vi.mock("@/cli/installTracking.js", () => ({
  buildCLIEventParams: vi.fn().mockResolvedValue({
    tilework_source: "nori-ai",
    tilework_session_id: "123456",
    tilework_timestamp: "2025-01-20T00:00:00.000Z",
    tilework_cli_executable_name: "nori-ai",
    tilework_cli_installed_version: "1.0.0",
    tilework_cli_install_source: "npm",
    tilework_cli_days_since_install: 0,
    tilework_cli_node_version: "20.0.0",
    tilework_cli_profile: null,
    tilework_cli_install_type: "unauthenticated",
  }),
  getUserId: vi.fn().mockResolvedValue(null),
  sendAnalyticsEvent: vi.fn(),
}));

vi.mock("@/cli/logger.js", () => ({
  info: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  newline: vi.fn(),
}));

// Import config loader before mocking so we can use it in tests that need real config behavior

// Default mock returns empty loaders, but tests can override mockLoaders to include config loader
let mockLoaders: Array<any> = [];

vi.mock("@/cli/features/claude-code/loaderRegistry.js", () => ({
  LoaderRegistry: {
    getInstance: () => ({
      getAll: () => mockLoaders,
      getAllReversed: () => [...mockLoaders].reverse(),
    }),
  },
}));

// Import after mocking

import {
  runUninstall,
  main,
  noninteractive,
  type PromptConfig,
} from "./uninstall.js";

vi.mock("@/cli/prompt.js", () => ({
  promptUser: vi.fn(),
}));

describe("uninstall idempotency", () => {
  let tempDir: string;
  let claudeDir: string;
  let skillsDir: string;
  let configPath: string;
  let originalHome: string | undefined;

  beforeEach(async () => {
    // Save original HOME
    originalHome = process.env.HOME;

    // Create temp directory for testing
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "uninstall-test-"));
    claudeDir = path.join(tempDir, ".claude");
    skillsDir = path.join(claudeDir, "skills");
    configPath = path.join(tempDir, "nori-config.json");

    // CRITICAL: Mock HOME to point to temp directory
    // This ensures ALL file operations using HOME are redirected to temp
    process.env.HOME = tempDir;

    // Set mock paths
    mockClaudeDir = claudeDir;
    mockConfigPath = configPath;

    // Reset mock config and loaders
    mockLoadedConfig = null;
    mockLoaders = [];
  });

  afterEach(async () => {
    // Restore original HOME
    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }

    // Clean up temp directory
    await fs.rm(tempDir, { recursive: true, force: true });

    // Clear all mocks
    vi.clearAllMocks();
  });

  it("should be idempotent when called on fresh system (no files exist)", async () => {
    // Multiple calls should not throw even when nothing is installed
    await expect(
      runUninstall({ removeGlobalSettings: true, installDir: tempDir }),
    ).resolves.not.toThrow();
    await expect(
      runUninstall({ removeGlobalSettings: true, installDir: tempDir }),
    ).resolves.not.toThrow();
    await expect(
      runUninstall({ removeGlobalSettings: true, installDir: tempDir }),
    ).resolves.not.toThrow();
  });

  it("should be idempotent when called multiple times after install", async () => {
    // Set up mock config
    mockLoadedConfig = {
      auth: {
        username: "test@example.com",
        password: "testpass",
        organizationUrl: "http://localhost:3000",
      },
    };

    // Create files to simulate installation
    await fs.mkdir(skillsDir, { recursive: true });
    await fs.writeFile(path.join(skillsDir, "test.txt"), "test content");
    await fs.writeFile(
      configPath,
      JSON.stringify({
        username: "test@example.com",
        password: "testpass",
        organizationUrl: "http://localhost:3000",
      }),
    );

    // First call - feature loaders clean up their files, preserves config
    await expect(
      runUninstall({ removeGlobalSettings: true, installDir: tempDir }),
    ).resolves.not.toThrow();

    // Verify config was preserved
    const configExists = await fs
      .access(configPath)
      .then(() => true)
      .catch(() => false);
    expect(configExists).toBe(true);

    // Second and third calls should not throw
    await expect(
      runUninstall({ removeGlobalSettings: true, installDir: tempDir }),
    ).resolves.not.toThrow();
    await expect(
      runUninstall({ removeGlobalSettings: true, installDir: tempDir }),
    ).resolves.not.toThrow();
  });

  it("should remove config when removeConfig is true", async () => {
    // Include config loader so it can delete files
    mockLoaders = [configLoader];

    // Set up mock config - no installedAgents means legacy behavior (delete file)
    mockLoadedConfig = {
      auth: {
        username: "test@example.com",
        password: "testpass",
        organizationUrl: "http://localhost:3000",
      },
    };

    // Create files
    await fs.mkdir(skillsDir, { recursive: true });
    await fs.writeFile(
      configPath,
      JSON.stringify({
        username: "test@example.com",
        password: "testpass",
        organizationUrl: "http://localhost:3000",
      }),
    );

    // Call with removeConfig: true
    await expect(
      runUninstall({ removeConfig: true, installDir: tempDir }),
    ).resolves.not.toThrow();

    // Verify config was removed
    const configExists = await fs
      .access(configPath)
      .then(() => true)
      .catch(() => false);
    expect(configExists).toBe(false);
  });

  it("should handle partial cleanup gracefully (some files missing)", async () => {
    // Create only skills directory (no config file)
    await fs.mkdir(skillsDir, { recursive: true });
    await fs.writeFile(path.join(skillsDir, "test.txt"), "test");

    // First call - feature loaders clean up, config doesn't exist
    await expect(
      runUninstall({ removeGlobalSettings: true, installDir: tempDir }),
    ).resolves.not.toThrow();

    // Create only config file (no skills directory)
    mockLoadedConfig = {
      auth: {
        username: "test",
        password: "test",
        organizationUrl: "test",
      },
    };
    await fs.writeFile(
      configPath,
      JSON.stringify({
        username: "test",
        password: "test",
        organizationUrl: "test",
      }),
    );

    // Second call - preserves config, skills don't exist
    await expect(
      runUninstall({ removeGlobalSettings: true, installDir: tempDir }),
    ).resolves.not.toThrow();

    // Third call - nothing new to clean
    await expect(
      runUninstall({ removeGlobalSettings: true, installDir: tempDir }),
    ).resolves.not.toThrow();
  });

  it("should preserve config when removeConfig is false (autoupdate scenario)", async () => {
    // This test simulates the autoupdate workflow:
    // 1. User has installed Nori with saved config
    // 2. Autoupdate runs `npm install -g nori-ai@newVersion && nori-ai install --non-interactive`
    // 3. Install first calls `nori-ai uninstall --non-interactive`
    // 4. Config must be preserved so install can use it

    const configData = {
      username: "user@example.com",
      password: "encrypted_password",
      organizationUrl: "https://api.nori.ai",
      preferences: {
        name: "co-pilot",
        useTDD: true,
        gitWorkflow: "ask",
        autonomyLevel: "collaborative",
        commitStyle: "ask-before-commit",
        autoDocument: false,
        bugFixing: "flag-only",
      },
    };

    // Set up mock config
    mockLoadedConfig = {
      auth: {
        username: configData.username,
        password: configData.password,
        organizationUrl: configData.organizationUrl,
      },
      preferences: configData.preferences,
    };

    // Create config file
    await fs.writeFile(configPath, JSON.stringify(configData));

    // Create skills directory to simulate installation
    await fs.mkdir(skillsDir, { recursive: true });
    await fs.writeFile(path.join(skillsDir, "test-skill.md"), "skill content");

    // Call uninstall with removeConfig: false (default behavior for non-interactive)
    // This simulates what happens during autoupdate
    await runUninstall({ removeConfig: false, installDir: tempDir });

    // Verify config was preserved
    const configExists = await fs
      .access(configPath)
      .then(() => true)
      .catch(() => false);
    expect(configExists).toBe(true);

    // Verify config content is unchanged
    const savedConfig = JSON.parse(await fs.readFile(configPath, "utf-8"));
    expect(savedConfig).toEqual(configData);

    // Verify features were cleaned up
    const skillsExists = await fs
      .access(skillsDir)
      .then(() => true)
      .catch(() => false);
    // Skills dir might still exist but should be empty or cleaned by loaders
    // (actual loaders are mocked in this test, so we just verify no errors)
    expect(skillsExists).toBe(true); // mkdir creates it but loaders would clean files
  });

  it("should NEVER touch real user config files", async () => {
    // This test verifies that tests don't delete real ~/nori-config.json or ~/.nori-installed-version
    //
    // CRITICAL: This test checks the real HOME directory to ensure no test pollution

    const realHome = originalHome || "~";
    const realConfigPath = path.join(realHome, "nori-config.json");
    const realVersionPath = path.join(realHome, ".nori-installed-version");

    // Check if real files exist BEFORE test
    const realConfigExistsBefore = await fs
      .access(realConfigPath)
      .then(() => true)
      .catch(() => false);
    const realVersionExistsBefore = await fs
      .access(realVersionPath)
      .then(() => true)
      .catch(() => false);

    // Create mock config and run uninstall with removeConfig: true
    mockLoadedConfig = {
      auth: {
        username: "test@example.com",
        password: "testpass",
        organizationUrl: "http://localhost:3000",
      },
    };

    await fs.mkdir(skillsDir, { recursive: true });
    await fs.writeFile(configPath, JSON.stringify(mockLoadedConfig));

    // Run uninstall with removeConfig: true (this SHOULD delete temp files, NOT real files)
    await runUninstall({ removeConfig: true, installDir: tempDir });

    // Check if real files exist AFTER test
    const realConfigExistsAfter = await fs
      .access(realConfigPath)
      .then(() => true)
      .catch(() => false);
    const realVersionExistsAfter = await fs
      .access(realVersionPath)
      .then(() => true)
      .catch(() => false);

    // CRITICAL: Real files should have same existence state before and after
    expect(realConfigExistsAfter).toBe(realConfigExistsBefore);
    expect(realVersionExistsAfter).toBe(realVersionExistsBefore);

    // If real files were deleted, fail with descriptive message
    if (realConfigExistsBefore && !realConfigExistsAfter) {
      throw new Error("TEST BUG: Deleted real ~/nori-config.json file!");
    }
    if (realVersionExistsBefore && !realVersionExistsAfter) {
      throw new Error("TEST BUG: Deleted real ~/.nori-installed-version file!");
    }
  });

  it("should have PromptConfig with removeGlobalSettings field (renamed from removeHooksAndStatusline)", () => {
    // This test verifies that the PromptConfig type has been renamed
    // from removeHooksAndStatusline to removeGlobalSettings
    const config: PromptConfig = {
      installDir: tempDir,
      removeGlobalSettings: true,
      selectedAgent: "claude-code",
    };

    // Verify the field exists on the type
    expect(config.removeGlobalSettings).toBe(true);
    expect(config.installDir).toBe(tempDir);
    expect(config.selectedAgent).toBe("claude-code");
  });
});

describe("uninstall prompt with agent-specific global features", () => {
  let tempDir: string;
  let originalHome: string | undefined;
  let processExitSpy: any;

  beforeEach(async () => {
    originalHome = process.env.HOME;
    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "uninstall-global-features-"),
    );
    process.env.HOME = tempDir;

    processExitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      // Intentionally empty
    }) as any);

    vi.clearAllMocks();
  });

  afterEach(async () => {
    processExitSpy.mockRestore();
    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }
    await fs.rm(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("should skip global settings prompt when agent has no global features", async () => {
    // Create a Nori installation
    const configPath = path.join(tempDir, ".nori-config.json");
    await fs.writeFile(configPath, JSON.stringify({}));

    // Mock a hypothetical agent with no global features
    // We need to mock the AgentRegistry to return an agent with empty getGlobalFeatureNames
    const { AgentRegistry } = await import("@/cli/features/agentRegistry.js");
    const mockAgent = {
      name: "mock-agent" as AgentName, // Cast for test mock
      displayName: "Mock Agent",
      getLoaderRegistry: () => ({
        getAll: () => [],
        getAllReversed: () => [],
      }),
      listProfiles: async () => [],
      switchProfile: async () => {
        // Mock implementation - intentionally empty
      },
      getGlobalLoaders: () => [], // Empty - no global features
    };

    const originalGet = AgentRegistry.getInstance().get.bind(
      AgentRegistry.getInstance(),
    );
    vi.spyOn(AgentRegistry.getInstance(), "get").mockImplementation((args) => {
      if (args.name === "mock-agent") {
        return mockAgent;
      }
      return originalGet(args);
    });

    // Mock user confirming uninstall (but should NOT be asked about global settings)
    (promptUser as any).mockResolvedValueOnce("y"); // Confirm uninstall only

    // Run uninstall with mock agent
    await main({
      nonInteractive: false,
      installDir: tempDir,
      agent: "mock-agent",
    });

    // Should only be called once (uninstall confirmation), NOT for global settings
    expect(promptUser).toHaveBeenCalledTimes(1);

    // The prompt should NOT contain "hooks" or "statusline" or "slash commands"
    const callArgs = (promptUser as any).mock.calls[0][0];
    expect(callArgs.prompt).not.toMatch(/hooks/i);
    expect(callArgs.prompt).not.toMatch(/statusline/i);
    expect(callArgs.prompt).not.toMatch(/slash commands/i);
  });

  it("should show agent-specific feature names in global settings prompt", async () => {
    // Create a Nori installation
    const configPath = path.join(tempDir, ".nori-config.json");
    await fs.writeFile(configPath, JSON.stringify({}));

    // Mock prompts: confirm uninstall, then confirm global settings removal
    (promptUser as any).mockResolvedValueOnce("y"); // Confirm uninstall
    (promptUser as any).mockResolvedValueOnce("y"); // Remove global settings

    // Run uninstall with cursor-agent (which has hooks and slash commands, but no statusline)
    await main({
      nonInteractive: false,
      installDir: tempDir,
      agent: "cursor-agent",
    });

    // Should be called twice (uninstall confirmation, global settings)
    expect(promptUser).toHaveBeenCalledTimes(2);

    // The global settings prompt should mention hooks and slash commands but NOT statusline
    const globalPromptArgs = (promptUser as any).mock.calls[1][0];
    expect(globalPromptArgs.prompt).toMatch(/hooks/i);
    expect(globalPromptArgs.prompt).toMatch(/slash commands/i);
    expect(globalPromptArgs.prompt).not.toMatch(/statusline/i);
  });
});

describe("uninstall with ancestor directory detection", () => {
  let tempDir: string;
  let parentDir: string;
  let childDir: string;
  let originalHome: string | undefined;
  let processExitSpy: any;

  beforeEach(async () => {
    // Save original HOME
    originalHome = process.env.HOME;

    // Create temp directory structure
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "uninstall-ancestor-"));
    parentDir = path.join(tempDir, "parent");
    childDir = path.join(parentDir, "child");

    await fs.mkdir(parentDir, { recursive: true });
    await fs.mkdir(childDir, { recursive: true });

    // Mock HOME to temp directory
    process.env.HOME = tempDir;

    // Mock process.exit to prevent tests from actually exiting
    processExitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      // Intentionally empty to prevent tests from exiting
    }) as any);

    // Clear mock calls
    vi.clearAllMocks();
  });

  afterEach(async () => {
    // Restore process.exit
    processExitSpy.mockRestore();

    // Restore original HOME
    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }

    // Clean up temp directory
    await fs.rm(tempDir, { recursive: true, force: true });

    // Clear all mocks
    vi.clearAllMocks();
  });

  it("should detect one ancestor installation and prompt user to uninstall from it", async () => {
    // Set up parent directory with Nori installation
    const parentConfigPath = path.join(parentDir, ".nori-config.json");
    await fs.writeFile(
      parentConfigPath,
      JSON.stringify({
        username: "test@example.com",
        password: "testpass",
        organizationUrl: "http://localhost:3000",
      }),
    );

    // Mock user confirmation (three calls: ancestor prompt, uninstall confirmation, hooks/statusline removal)
    (promptUser as any).mockResolvedValueOnce("y"); // Accept ancestor uninstall
    (promptUser as any).mockResolvedValueOnce("y"); // Confirm uninstall
    (promptUser as any).mockResolvedValueOnce("y"); // Remove hooks/statusline

    // Run uninstall from child directory (no installation in child)
    await main({ nonInteractive: false, installDir: childDir });

    // Verify promptUser was called three times (ancestor, uninstall confirm, hooks/statusline)
    expect(promptUser).toHaveBeenCalledTimes(3);

    // Verify the first call asks about the ancestor directory
    const firstCall = (promptUser as any).mock.calls[0][0];
    expect(firstCall.prompt).toMatch(/ancestor/i);
  });

  it("should handle multiple ancestor installations and let user select", async () => {
    // Set up grandparent and parent directories with Nori installations
    const grandparentDir = path.join(tempDir, "grandparent");
    const parentInGrandparent = path.join(grandparentDir, "parent");
    const childInParent = path.join(parentInGrandparent, "child");

    await fs.mkdir(grandparentDir, { recursive: true });
    await fs.mkdir(parentInGrandparent, { recursive: true });
    await fs.mkdir(childInParent, { recursive: true });

    // Create installations in both grandparent and parent
    await fs.writeFile(
      path.join(grandparentDir, ".nori-config.json"),
      JSON.stringify({
        username: "test1",
        password: "test1",
        organizationUrl: "test1",
      }),
    );
    await fs.writeFile(
      path.join(parentInGrandparent, ".nori-config.json"),
      JSON.stringify({
        username: "test2",
        password: "test2",
        organizationUrl: "test2",
      }),
    );

    // Mock user responses: select option 2, confirm, remove hooks/statusline
    (promptUser as any).mockResolvedValueOnce("2"); // Select second installation
    (promptUser as any).mockResolvedValueOnce("y"); // Confirm uninstall
    (promptUser as any).mockResolvedValueOnce("y"); // Remove hooks/statusline

    // Run from child directory
    await main({ nonInteractive: false, installDir: childInParent });

    // Verify promptUser was called three times
    expect(promptUser).toHaveBeenCalledTimes(3);

    // Verify first call asks for selection
    const firstCall = (promptUser as any).mock.calls[0][0];
    expect(firstCall.prompt).toMatch(/select.*installation/i);
  });

  it("should exit gracefully when no installation found anywhere", async () => {
    // Create empty directory with no installations
    const emptyDir = path.join(tempDir, "empty");
    await fs.mkdir(emptyDir, { recursive: true });

    // Run uninstall from empty directory
    await main({ nonInteractive: false, installDir: emptyDir });

    // Verify promptUser was never called (no installation to uninstall)
    expect(promptUser).not.toHaveBeenCalled();
  });

  it("should cancel when user declines ancestor uninstall", async () => {
    // Set up parent with installation
    await fs.writeFile(
      path.join(parentDir, ".nori-config.json"),
      JSON.stringify({
        username: "test",
        password: "test",
        organizationUrl: "test",
      }),
    );

    // Mock user declining
    (promptUser as any).mockResolvedValueOnce("n");

    // Run from child directory
    await main({ nonInteractive: false, installDir: childDir });

    // Verify promptUser was only called once (for ancestor prompt, not uninstall)
    expect(promptUser).toHaveBeenCalledTimes(1);
  });

  it("should handle invalid selection from multiple ancestors", async () => {
    // Set up grandparent and parent with installations
    const grandparentDir = path.join(tempDir, "gp2");
    const parentInGrandparent = path.join(grandparentDir, "p2");
    const childInParent = path.join(parentInGrandparent, "c2");

    await fs.mkdir(grandparentDir, { recursive: true });
    await fs.mkdir(parentInGrandparent, { recursive: true });
    await fs.mkdir(childInParent, { recursive: true });

    await fs.writeFile(
      path.join(grandparentDir, ".nori-config.json"),
      JSON.stringify({
        username: "test1",
        password: "test1",
        organizationUrl: "test1",
      }),
    );
    await fs.writeFile(
      path.join(parentInGrandparent, ".nori-config.json"),
      JSON.stringify({
        username: "test2",
        password: "test2",
        organizationUrl: "test2",
      }),
    );

    // Mock invalid selection
    (promptUser as any).mockResolvedValueOnce("999");

    // Run from child
    await main({ nonInteractive: false, installDir: childInParent });

    // Verify only one prompt (cancelled after invalid selection)
    expect(promptUser).toHaveBeenCalledTimes(1);
  });
});

describe("uninstall agent detection from config", () => {
  let tempDir: string;
  let originalHome: string | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let agentRegistryGetSpy: any;

  beforeEach(async () => {
    originalHome = process.env.HOME;
    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "uninstall-agent-detection-"),
    );
    process.env.HOME = tempDir;

    // Set mock paths
    mockClaudeDir = path.join(tempDir, ".claude");
    mockConfigPath = path.join(tempDir, ".nori-config.json");

    // Spy on AgentRegistry to see which agent is being used
    const { AgentRegistry } = await import("@/cli/features/agentRegistry.js");
    agentRegistryGetSpy = vi.spyOn(AgentRegistry.getInstance(), "get");

    vi.clearAllMocks();
  });

  afterEach(async () => {
    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }
    await fs.rm(tempDir, { recursive: true, force: true });
    agentRegistryGetSpy?.mockRestore();
    vi.clearAllMocks();
  });

  it("should detect cursor-agent from config in non-interactive mode", async () => {
    // Create config with cursor-agent installed (via agents object)
    mockLoadedConfig = {
      agents: { "cursor-agent": {} },
      installDir: tempDir,
    };
    await fs.writeFile(
      mockConfigPath,
      JSON.stringify({ agents: { "cursor-agent": {} } }),
    );

    // Run non-interactive uninstall WITHOUT --agent flag
    await noninteractive({ installDir: tempDir });

    // Verify that cursor-agent was used (not claude-code)
    // The AgentRegistry.get() should have been called with cursor-agent
    expect(agentRegistryGetSpy).toHaveBeenCalledWith({ name: "cursor-agent" });
  });

  it("should default to claude-code when no agents in config", async () => {
    // Create config without agents
    mockLoadedConfig = {
      installDir: tempDir,
    };
    await fs.writeFile(mockConfigPath, JSON.stringify({}));

    // Run non-interactive uninstall WITHOUT --agent flag
    await noninteractive({ installDir: tempDir });

    // Should use claude-code by default
    expect(agentRegistryGetSpy).toHaveBeenCalledWith({ name: "claude-code" });
  });

  it("should default to claude-code when config doesn't exist", async () => {
    // No config file
    mockLoadedConfig = null;

    // Run non-interactive uninstall WITHOUT --agent flag
    await noninteractive({ installDir: tempDir });

    // Should use claude-code by default
    expect(agentRegistryGetSpy).toHaveBeenCalledWith({ name: "claude-code" });
  });

  it("should default to claude-code when multiple agents are installed", async () => {
    // Create config with multiple agents installed (via agents object)
    mockLoadedConfig = {
      agents: {
        "claude-code": {},
        "cursor-agent": {},
      },
      installDir: tempDir,
    };
    await fs.writeFile(
      mockConfigPath,
      JSON.stringify({ agents: { "claude-code": {}, "cursor-agent": {} } }),
    );

    // Run non-interactive uninstall WITHOUT --agent flag
    await noninteractive({ installDir: tempDir });

    // Should default to claude-code when there are multiple agents
    // (can't auto-detect which one to uninstall)
    expect(agentRegistryGetSpy).toHaveBeenCalledWith({ name: "claude-code" });
  });
});

describe("uninstall multi-agent config preservation", () => {
  let tempDir: string;
  let configPath: string;
  let originalHome: string | undefined;

  beforeEach(async () => {
    originalHome = process.env.HOME;
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "uninstall-multiagent-"));
    process.env.HOME = tempDir;

    configPath = path.join(tempDir, ".nori-config.json");

    // Set mock paths for this test
    mockClaudeDir = path.join(tempDir, ".claude");
    mockConfigPath = configPath;

    // Include config loader so it can handle file operations
    mockLoaders = [configLoader];

    vi.clearAllMocks();
  });

  afterEach(async () => {
    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }
    await fs.rm(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("should preserve config file when uninstalling one of multiple agents with removeConfig=true", async () => {
    // Create config with multiple agents installed (version is now in config)
    const initialConfig = {
      installDir: tempDir,
      agents: {
        "claude-code": { profile: { baseProfile: "senior-swe" } },
        "cursor-agent": { profile: { baseProfile: "senior-swe" } },
      },
      version: "19.0.0",
    };
    await fs.writeFile(configPath, JSON.stringify(initialConfig));

    // Mock loadConfig to return our multi-agent config
    mockLoadedConfig = {
      ...initialConfig,
    };

    // Run uninstall with removeConfig=true for cursor-agent
    await runUninstall({
      removeConfig: true,
      removeGlobalSettings: false,
      installDir: tempDir,
      agent: "cursor-agent",
    });

    // Config file should still exist because claude-code is still installed
    const configExists = await fs
      .access(configPath)
      .then(() => true)
      .catch(() => false);
    expect(configExists).toBe(true);

    // Version should be preserved in config
    const config = JSON.parse(await fs.readFile(configPath, "utf-8"));
    expect(config.version).toBe("19.0.0");
  });

  it("should delete config when uninstalling last agent with removeConfig=true", async () => {
    // Create config with single agent (version is now in config)
    const initialConfig = {
      installDir: tempDir,
      agents: {
        "claude-code": { profile: { baseProfile: "senior-swe" } },
      },
      version: "19.0.0",
    };
    await fs.writeFile(configPath, JSON.stringify(initialConfig));

    // Mock loadConfig to return single-agent config
    mockLoadedConfig = {
      ...initialConfig,
    };

    // Run uninstall with removeConfig=true for the only agent
    await runUninstall({
      removeConfig: true,
      removeGlobalSettings: false,
      installDir: tempDir,
      agent: "claude-code",
    });

    // Config file should be deleted since no agents remain (version is in config)
    const configExists = await fs
      .access(configPath)
      .then(() => true)
      .catch(() => false);
    expect(configExists).toBe(false);
  });

  it("should show remaining agents message when uninstalling one of multiple agents", async () => {
    // Create config with multiple agents installed (version is now in config)
    const initialConfig = {
      installDir: tempDir,
      agents: {
        "claude-code": { profile: { baseProfile: "senior-swe" } },
        "cursor-agent": { profile: { baseProfile: "senior-swe" } },
      },
      version: "19.0.0",
    };
    await fs.writeFile(configPath, JSON.stringify(initialConfig));

    // Mock loadConfig to return our multi-agent config
    mockLoadedConfig = {
      ...initialConfig,
    };

    // Import logger to check messages
    const { info } = await import("@/cli/logger.js");

    // Run uninstall with removeConfig=true for cursor-agent
    await runUninstall({
      removeConfig: true,
      removeGlobalSettings: false,
      installDir: tempDir,
      agent: "cursor-agent",
    });

    // Check that info was called with message about remaining agents
    const infoCalls = (info as any).mock.calls;
    const messages = infoCalls.map((call: any) => call[0]?.message || "");

    // Should mention remaining agent(s)
    const hasRemainingAgentMessage = messages.some(
      (msg: string) =>
        msg.includes("remaining") ||
        msg.includes("claude-code") ||
        msg.includes("still installed"),
    );
    expect(hasRemainingAgentMessage).toBe(true);

    // Should show command to uninstall remaining agents
    const hasUninstallCommand = messages.some(
      (msg: string) =>
        msg.includes("nori-ai uninstall") && msg.includes("--agent"),
    );
    expect(hasUninstallCommand).toBe(true);
  });
});
