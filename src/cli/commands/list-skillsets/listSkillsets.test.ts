/**
 * Tests for list-skillsets command
 * Tests that the command correctly lists locally available profiles
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { AgentRegistry } from "@/cli/features/agentRegistry.js";

import { listSkillsetsMain } from "./listSkillsets.js";

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
vi.mock("@/cli/logger.js", () => ({
  raw: (args: { message: string }) => mockRaw(args),
  error: (args: { message: string }) => mockError(args),
}));

// Mock process.exit
const mockExit = vi
  .spyOn(process, "exit")
  .mockImplementation(() => undefined as never);

describe("listSkillsetsMain", () => {
  let testInstallDir: string;

  beforeEach(async () => {
    testInstallDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "list-skillsets-test-"),
    );
    vi.mocked(os.homedir).mockReturnValue(testInstallDir);
    const testNoriDir = path.join(testInstallDir, ".nori");
    await fs.mkdir(testNoriDir, { recursive: true });
    AgentRegistry.resetInstance();
    mockRaw.mockClear();
    mockError.mockClear();
    mockExit.mockClear();
  });

  afterEach(async () => {
    if (testInstallDir) {
      await fs.rm(testInstallDir, { recursive: true, force: true });
    }
    AgentRegistry.resetInstance();
  });

  it("should list all installed profiles one per line", async () => {
    const profilesDir = path.join(testInstallDir, ".nori", "profiles");
    await fs.mkdir(profilesDir, { recursive: true });

    // Create test profiles
    for (const name of ["senior-swe", "product-manager", "custom-profile"]) {
      const dir = path.join(profilesDir, name);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(
        path.join(dir, "nori.json"),
        JSON.stringify({ name, version: "1.0.0" }),
      );
    }

    await listSkillsetsMain({
      installDir: testInstallDir,
      agent: "claude-code",
    });

    // Should output each profile name via raw logger
    expect(mockRaw).toHaveBeenCalledWith({ message: "senior-swe" });
    expect(mockRaw).toHaveBeenCalledWith({ message: "product-manager" });
    expect(mockRaw).toHaveBeenCalledWith({ message: "custom-profile" });
    expect(mockRaw).toHaveBeenCalledTimes(3);
  });

  it("should error with exit code 1 when no profiles are installed", async () => {
    const profilesDir = path.join(testInstallDir, ".nori", "profiles");
    await fs.mkdir(profilesDir, { recursive: true });

    await listSkillsetsMain({
      installDir: testInstallDir,
      agent: "claude-code",
    });

    // Should output error message and exit with code 1
    expect(mockError).toHaveBeenCalledWith({
      message: expect.stringContaining("No skillsets installed"),
    });
    expect(mockExit).toHaveBeenCalledWith(1);
    expect(mockRaw).not.toHaveBeenCalled();
  });

  it("should error with exit code 1 when unknown agent is specified", async () => {
    await listSkillsetsMain({
      installDir: testInstallDir,
      agent: "unknown-agent",
    });

    // Should output error message about unknown agent
    expect(mockError).toHaveBeenCalledWith({
      message: expect.stringContaining("Unknown agent 'unknown-agent'"),
    });
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("should auto-detect agent from config when not specified", async () => {
    // Create config with claude-code
    const configPath = path.join(testInstallDir, ".nori-config.json");
    await fs.writeFile(
      configPath,
      JSON.stringify({
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      }),
    );

    // Create profiles
    const profilesDir = path.join(testInstallDir, ".nori", "profiles");
    await fs.mkdir(profilesDir, { recursive: true });
    const dir = path.join(profilesDir, "senior-swe");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, "nori.json"),
      JSON.stringify({ name: "senior-swe", version: "1.0.0" }),
    );

    await listSkillsetsMain({
      installDir: testInstallDir,
      agent: null,
    });

    // Should detect claude-code and list its profiles
    expect(mockRaw).toHaveBeenCalledWith({ message: "senior-swe" });
  });

  it("should default to claude-code when no agents installed", async () => {
    // No config file, no agents installed
    const profilesDir = path.join(testInstallDir, ".nori", "profiles");
    await fs.mkdir(profilesDir, { recursive: true });
    const dir = path.join(profilesDir, "test-profile");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, "nori.json"),
      JSON.stringify({ name: "test-profile", version: "1.0.0" }),
    );

    await listSkillsetsMain({
      installDir: testInstallDir,
      agent: null,
    });

    // Should default to claude-code
    expect(mockRaw).toHaveBeenCalledWith({ message: "test-profile" });
  });
});

describe("listSkillsetsMain output format", () => {
  let testInstallDir: string;

  beforeEach(async () => {
    testInstallDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "list-skillsets-format-test-"),
    );
    vi.mocked(os.homedir).mockReturnValue(testInstallDir);
    const testNoriDir = path.join(testInstallDir, ".nori");
    await fs.mkdir(testNoriDir, { recursive: true });
    AgentRegistry.resetInstance();
    mockRaw.mockClear();
    mockError.mockClear();
    mockExit.mockClear();
  });

  afterEach(async () => {
    if (testInstallDir) {
      await fs.rm(testInstallDir, { recursive: true, force: true });
    }
    AgentRegistry.resetInstance();
  });

  it("should output plain profile names without formatting", async () => {
    const profilesDir = path.join(testInstallDir, ".nori", "profiles");
    await fs.mkdir(profilesDir, { recursive: true });

    const dir = path.join(profilesDir, "my-profile");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, "nori.json"),
      JSON.stringify({ name: "my-profile", version: "1.0.0" }),
    );

    await listSkillsetsMain({
      installDir: testInstallDir,
      agent: "claude-code",
    });

    // Verify raw was called (unformatted output)
    expect(mockRaw).toHaveBeenCalledWith({ message: "my-profile" });
    // Error should not be called
    expect(mockError).not.toHaveBeenCalled();
    expect(mockExit).not.toHaveBeenCalled();
  });
});

describe("listSkillsetsMain error messages", () => {
  let testInstallDir: string;

  beforeEach(async () => {
    testInstallDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "list-skillsets-error-test-"),
    );
    vi.mocked(os.homedir).mockReturnValue(testInstallDir);
    AgentRegistry.resetInstance();
    mockRaw.mockClear();
    mockError.mockClear();
    mockExit.mockClear();
  });

  afterEach(async () => {
    if (testInstallDir) {
      await fs.rm(testInstallDir, { recursive: true, force: true });
    }
    AgentRegistry.resetInstance();
  });

  it("should include install path in no skillsets error message", async () => {
    const testNoriDir = path.join(testInstallDir, ".nori");
    await fs.mkdir(testNoriDir, { recursive: true });
    const profilesDir = path.join(testNoriDir, "profiles");
    await fs.mkdir(profilesDir, { recursive: true });

    await listSkillsetsMain({
      installDir: testInstallDir,
      agent: "claude-code",
    });

    // Error message should include the install path
    expect(mockError).toHaveBeenCalledWith({
      message: expect.stringContaining(testInstallDir),
    });
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("should include agent display name in no skillsets error message", async () => {
    const testNoriDir = path.join(testInstallDir, ".nori");
    await fs.mkdir(testNoriDir, { recursive: true });
    const profilesDir = path.join(testNoriDir, "profiles");
    await fs.mkdir(profilesDir, { recursive: true });

    await listSkillsetsMain({
      installDir: testInstallDir,
      agent: "claude-code",
    });

    // Error message should include the agent display name
    expect(mockError).toHaveBeenCalledWith({
      message: expect.stringContaining("Claude Code"),
    });
  });

  it("should list available agents in unknown agent error", async () => {
    await listSkillsetsMain({
      installDir: testInstallDir,
      agent: "invalid-agent",
    });

    // Error message should list available agents
    expect(mockError).toHaveBeenCalledWith({
      message: expect.stringMatching(/Available:.*claude-code/),
    });
    expect(mockExit).toHaveBeenCalledWith(1);
  });
});
