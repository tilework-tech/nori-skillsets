/**
 * Tests for current-skillset command
 * Tests that the command correctly displays the currently active skillset
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { AgentRegistry } from "@/cli/features/agentRegistry.js";

import { currentSkillsetMain } from "./currentSkillset.js";

// Mock os.homedir so config paths resolve to the test directory
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

describe("currentSkillsetMain", () => {
  let testHomeDir: string;

  beforeEach(async () => {
    testHomeDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "current-skillset-test-"),
    );
    vi.mocked(os.homedir).mockReturnValue(testHomeDir);
    const testNoriDir = path.join(testHomeDir, ".nori");
    await fs.mkdir(testNoriDir, { recursive: true });
    AgentRegistry.resetInstance();
    mockRaw.mockClear();
    mockError.mockClear();
    mockExit.mockClear();
  });

  afterEach(async () => {
    if (testHomeDir) {
      await fs.rm(testHomeDir, { recursive: true, force: true });
    }
    AgentRegistry.resetInstance();
  });

  it("should display active skillset name when config is valid", async () => {
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

    await currentSkillsetMain({ agent: null });

    // Should output the skillset name
    expect(mockRaw).toHaveBeenCalledWith({ message: "senior-swe" });
    expect(mockExit).not.toHaveBeenCalled();
  });

  it("should error when no config file exists", async () => {
    // No config file created

    await currentSkillsetMain({ agent: null });

    expect(mockError).toHaveBeenCalledWith({
      message: expect.stringContaining("No active skillset"),
    });
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("should error when config exists but no active skillset is configured", async () => {
    // Config with no agents
    const configPath = path.join(testHomeDir, ".nori-config.json");
    await fs.writeFile(
      configPath,
      JSON.stringify({
        agents: {},
        installDir: testHomeDir,
      }),
    );

    await currentSkillsetMain({ agent: null });

    expect(mockError).toHaveBeenCalledWith({
      message: expect.stringContaining("No active skillset"),
    });
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("should use specified agent when --agent option is provided", async () => {
    // Config with multiple agents
    const configPath = path.join(testHomeDir, ".nori-config.json");
    await fs.writeFile(
      configPath,
      JSON.stringify({
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
          "custom-agent": { profile: { baseProfile: "custom-skillset" } },
        },
        installDir: testHomeDir,
      }),
    );

    await currentSkillsetMain({
      agent: "custom-agent",
    });

    // Should output the custom agent's skillset
    expect(mockRaw).toHaveBeenCalledWith({ message: "custom-skillset" });
    expect(mockExit).not.toHaveBeenCalled();
  });

  it("should use first installed agent when no agent is specified", async () => {
    // Config with multiple agents - first one should be used
    const configPath = path.join(testHomeDir, ".nori-config.json");
    await fs.writeFile(
      configPath,
      JSON.stringify({
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
          "other-agent": { profile: { baseProfile: "other-skillset" } },
        },
        installDir: testHomeDir,
      }),
    );

    await currentSkillsetMain({ agent: null });

    // Should output the first agent's skillset (claude-code)
    expect(mockRaw).toHaveBeenCalledWith({ message: "senior-swe" });
    expect(mockExit).not.toHaveBeenCalled();
  });

  it("should handle namespaced skillset names correctly", async () => {
    // Config with namespaced profile
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

    await currentSkillsetMain({ agent: null });

    // Should output the namespaced skillset name
    expect(mockRaw).toHaveBeenCalledWith({ message: "myorg/my-profile" });
    expect(mockExit).not.toHaveBeenCalled();
  });

  it("should error when specified agent has no profile configured", async () => {
    // Config with agent but no profile
    const configPath = path.join(testHomeDir, ".nori-config.json");
    await fs.writeFile(
      configPath,
      JSON.stringify({
        agents: {
          "claude-code": {},
        },
        installDir: testHomeDir,
      }),
    );

    await currentSkillsetMain({ agent: null });

    expect(mockError).toHaveBeenCalledWith({
      message: expect.stringContaining("No active skillset"),
    });
    expect(mockExit).toHaveBeenCalledWith(1);
  });
});
