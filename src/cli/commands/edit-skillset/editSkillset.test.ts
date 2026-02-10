/**
 * Tests for edit-skillset command
 * Tests that the command correctly opens the active skillset folder in VS Code
 * or falls back to printing directory contents with instructions
 */

import * as childProcess from "child_process";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { AgentRegistry } from "@/cli/features/agentRegistry.js";

import { editSkillsetMain } from "./editSkillset.js";

// Mock os.homedir so getNoriProfilesDir() resolves to the test directory
vi.mock("os", async (importOriginal) => {
  const actual = await importOriginal<typeof os>();
  return {
    ...actual,
    homedir: vi.fn().mockReturnValue(actual.homedir()),
  };
});

// Mock logger to capture output
const mockRaw = vi.fn();
const mockError = vi.fn();
const mockInfo = vi.fn();
const mockSuccess = vi.fn();
const mockNewline = vi.fn();
vi.mock("@/cli/logger.js", () => ({
  raw: (args: { message: string }) => mockRaw(args),
  error: (args: { message: string }) => mockError(args),
  info: (args: { message: string }) => mockInfo(args),
  success: (args: { message: string }) => mockSuccess(args),
  newline: () => mockNewline(),
}));

// Mock child_process.execFile
vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof childProcess>();
  return {
    ...actual,
    execFile: vi.fn(),
  };
});

// Typed reference to the mocked execFile
const mockExecFile = childProcess.execFile as unknown as ReturnType<
  typeof vi.fn
>;

// Mock process.exit
const mockExit = vi
  .spyOn(process, "exit")
  .mockImplementation(() => undefined as never);

describe("editSkillsetMain", () => {
  let testHomeDir: string;

  beforeEach(async () => {
    testHomeDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "edit-skillset-test-"),
    );
    vi.mocked(os.homedir).mockReturnValue(testHomeDir);
    const testNoriDir = path.join(testHomeDir, ".nori");
    await fs.mkdir(testNoriDir, { recursive: true });
    AgentRegistry.resetInstance();
    mockRaw.mockClear();
    mockError.mockClear();
    mockInfo.mockClear();
    mockSuccess.mockClear();
    mockNewline.mockClear();
    mockExit.mockClear();
    mockExecFile.mockReset();
  });

  afterEach(async () => {
    if (testHomeDir) {
      await fs.rm(testHomeDir, { recursive: true, force: true });
    }
    AgentRegistry.resetInstance();
  });

  it("should open active profile directory in VS Code when available", async () => {
    // Set up config with active profile
    const configPath = path.join(testHomeDir, ".nori-config.json");
    await fs.writeFile(
      configPath,
      JSON.stringify({
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
        installDir: testHomeDir,
      }),
    );

    // Create profile directory
    const profilesDir = path.join(testHomeDir, ".nori", "profiles");
    const profileDir = path.join(profilesDir, "senior-swe");
    await fs.mkdir(profileDir, { recursive: true });
    await fs.writeFile(
      path.join(profileDir, "nori.json"),
      JSON.stringify({ name: "senior-swe", version: "1.0.0" }),
    );

    // Mock execFile to succeed
    mockExecFile.mockImplementation((_cmd, _args, callback) => {
      if (typeof callback === "function") {
        callback(null, "", "");
      }
      return {} as any;
    });

    await editSkillsetMain({ agent: "claude-code" });

    // Should have called execFile with 'code' and the profile path
    expect(mockExecFile).toHaveBeenCalledWith(
      "code",
      [profileDir],
      expect.any(Function),
    );

    // Should print a success message
    expect(mockSuccess).toHaveBeenCalledWith({
      message: expect.stringContaining("senior-swe"),
    });
    expect(mockExit).not.toHaveBeenCalled();
  });

  it("should fall back to listing directory contents when VS Code is not available", async () => {
    // Set up config with active profile
    const configPath = path.join(testHomeDir, ".nori-config.json");
    await fs.writeFile(
      configPath,
      JSON.stringify({
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
        installDir: testHomeDir,
      }),
    );

    // Create profile directory with some files
    const profilesDir = path.join(testHomeDir, ".nori", "profiles");
    const profileDir = path.join(profilesDir, "senior-swe");
    await fs.mkdir(path.join(profileDir, "skills", "my-skill"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(profileDir, "nori.json"),
      JSON.stringify({ name: "senior-swe", version: "1.0.0" }),
    );
    await fs.writeFile(
      path.join(profileDir, "skills", "my-skill", "SKILL.md"),
      "# my-skill",
    );

    // Mock execFile to fail with ENOENT (code not found)
    mockExecFile.mockImplementation((_cmd, _args, callback) => {
      if (typeof callback === "function") {
        const err = new Error("spawn code ENOENT") as NodeJS.ErrnoException;
        err.code = "ENOENT";
        callback(err, "", "");
      }
      return {} as any;
    });

    await editSkillsetMain({ agent: "claude-code" });

    // Should print the profile directory path
    const allRawMessages = mockRaw.mock.calls.map(
      (call) => (call[0] as { message: string }).message,
    );
    const allInfoMessages = mockInfo.mock.calls.map(
      (call) => (call[0] as { message: string }).message,
    );
    const allMessages = [...allRawMessages, ...allInfoMessages];

    expect(allMessages.some((m) => m.includes(profileDir))).toBe(true);

    // Should list directory contents
    expect(allRawMessages.some((m) => m.includes("nori.json"))).toBe(true);
    expect(allRawMessages.some((m) => m.includes("skills"))).toBe(true);

    // Should NOT exit with error
    expect(mockExit).not.toHaveBeenCalled();
  });

  it("should error when no active profile is configured", async () => {
    // Config with no profile set
    const configPath = path.join(testHomeDir, ".nori-config.json");
    await fs.writeFile(
      configPath,
      JSON.stringify({
        agents: { "claude-code": {} },
        installDir: testHomeDir,
      }),
    );

    await editSkillsetMain({ agent: "claude-code" });

    expect(mockError).toHaveBeenCalledWith({
      message: expect.stringContaining("No active skillset"),
    });
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("should error when profile directory does not exist on disk", async () => {
    // Config references a profile that doesn't exist on disk
    const configPath = path.join(testHomeDir, ".nori-config.json");
    await fs.writeFile(
      configPath,
      JSON.stringify({
        agents: {
          "claude-code": { profile: { baseProfile: "nonexistent" } },
        },
        installDir: testHomeDir,
      }),
    );

    // Profiles dir exists but the specific profile does not
    const profilesDir = path.join(testHomeDir, ".nori", "profiles");
    await fs.mkdir(profilesDir, { recursive: true });

    await editSkillsetMain({ agent: "claude-code" });

    expect(mockError).toHaveBeenCalledWith({
      message: expect.stringContaining("nonexistent"),
    });
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("should use the --agent flag to select the agent profile", async () => {
    // Config with claude-code agent
    const configPath = path.join(testHomeDir, ".nori-config.json");
    await fs.writeFile(
      configPath,
      JSON.stringify({
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
        installDir: testHomeDir,
      }),
    );

    // Create profile directory
    const profilesDir = path.join(testHomeDir, ".nori", "profiles");
    const profileDir = path.join(profilesDir, "senior-swe");
    await fs.mkdir(profileDir, { recursive: true });
    await fs.writeFile(
      path.join(profileDir, "nori.json"),
      JSON.stringify({ name: "senior-swe", version: "1.0.0" }),
    );

    // Mock execFile to succeed
    mockExecFile.mockImplementation((_cmd, _args, callback) => {
      if (typeof callback === "function") {
        callback(null, "", "");
      }
      return {} as any;
    });

    await editSkillsetMain({ agent: "claude-code" });

    expect(mockExecFile).toHaveBeenCalledWith(
      "code",
      [profileDir],
      expect.any(Function),
    );

    expect(mockSuccess).toHaveBeenCalledWith({
      message: expect.stringContaining("senior-swe"),
    });
  });

  it("should resolve namespaced profiles correctly", async () => {
    // Config with a namespaced profile
    const configPath = path.join(testHomeDir, ".nori-config.json");
    await fs.writeFile(
      configPath,
      JSON.stringify({
        agents: {
          "claude-code": { profile: { baseProfile: "myorg/my-profile" } },
        },
        installDir: testHomeDir,
      }),
    );

    // Create namespaced profile directory
    const profilesDir = path.join(testHomeDir, ".nori", "profiles");
    const profileDir = path.join(profilesDir, "myorg", "my-profile");
    await fs.mkdir(profileDir, { recursive: true });
    await fs.writeFile(
      path.join(profileDir, "nori.json"),
      JSON.stringify({ name: "my-profile", version: "1.0.0" }),
    );

    // Mock execFile to succeed
    mockExecFile.mockImplementation((_cmd, _args, callback) => {
      if (typeof callback === "function") {
        callback(null, "", "");
      }
      return {} as any;
    });

    await editSkillsetMain({ agent: "claude-code" });

    expect(mockExecFile).toHaveBeenCalledWith(
      "code",
      [profileDir],
      expect.any(Function),
    );

    expect(mockSuccess).toHaveBeenCalledWith({
      message: expect.stringContaining("myorg/my-profile"),
    });
  });

  it("should open specified profile when name argument is provided", async () => {
    // Config with active profile senior-swe, but we want to open a different one
    const configPath = path.join(testHomeDir, ".nori-config.json");
    await fs.writeFile(
      configPath,
      JSON.stringify({
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
        installDir: testHomeDir,
      }),
    );

    // Create both profile directories
    const profilesDir = path.join(testHomeDir, ".nori", "profiles");
    for (const name of ["senior-swe", "product-manager"]) {
      const dir = path.join(profilesDir, name);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(
        path.join(dir, "nori.json"),
        JSON.stringify({ name, version: "1.0.0" }),
      );
    }

    // Mock execFile to succeed
    mockExecFile.mockImplementation((_cmd, _args, callback) => {
      if (typeof callback === "function") {
        callback(null, "", "");
      }
      return {} as any;
    });

    // Pass name argument to open product-manager instead of active profile
    await editSkillsetMain({ agent: "claude-code", name: "product-manager" });

    const expectedDir = path.join(profilesDir, "product-manager");
    expect(mockExecFile).toHaveBeenCalledWith(
      "code",
      [expectedDir],
      expect.any(Function),
    );

    expect(mockSuccess).toHaveBeenCalledWith({
      message: expect.stringContaining("product-manager"),
    });
  });

  it("should auto-detect agent and use its active profile when no agent or name is given", async () => {
    // Config with claude-code agent auto-detectable
    const configPath = path.join(testHomeDir, ".nori-config.json");
    await fs.writeFile(
      configPath,
      JSON.stringify({
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
        installDir: testHomeDir,
      }),
    );

    // Create profile directory
    const profilesDir = path.join(testHomeDir, ".nori", "profiles");
    const profileDir = path.join(profilesDir, "senior-swe");
    await fs.mkdir(profileDir, { recursive: true });
    await fs.writeFile(
      path.join(profileDir, "nori.json"),
      JSON.stringify({ name: "senior-swe", version: "1.0.0" }),
    );

    // Mock execFile to succeed
    mockExecFile.mockImplementation((_cmd, _args, callback) => {
      if (typeof callback === "function") {
        callback(null, "", "");
      }
      return {} as any;
    });

    // Neither name nor agent provided - should auto-detect both
    await editSkillsetMain({});

    expect(mockExecFile).toHaveBeenCalledWith(
      "code",
      [profileDir],
      expect.any(Function),
    );

    expect(mockSuccess).toHaveBeenCalledWith({
      message: expect.stringContaining("senior-swe"),
    });
  });

  it("should error when no config exists and no name argument is given", async () => {
    // No config file at all
    await editSkillsetMain({ agent: "claude-code" });

    expect(mockError).toHaveBeenCalledWith({
      message: expect.stringContaining("No active skillset"),
    });
    expect(mockExit).toHaveBeenCalledWith(1);
  });
});
