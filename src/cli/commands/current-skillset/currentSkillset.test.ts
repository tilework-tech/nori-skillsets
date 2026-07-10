/**
 * Tests for current-skillset command
 * Tests that the command correctly displays the currently active skillset
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { log } from "@clack/prompts";
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

// Mock @clack/prompts
vi.mock("@clack/prompts", () => ({
  log: {
    error: vi.fn(),
  },
}));

// Mock process.exit
const mockExit = vi
  .spyOn(process, "exit")
  .mockImplementation(() => undefined as never);

// Mock process.stdout.write for raw output
const mockStdoutWrite = vi
  .spyOn(process.stdout, "write")
  .mockImplementation(() => true);

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
    vi.mocked(log.error).mockClear();
    mockExit.mockClear();
    mockStdoutWrite.mockClear();
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
        activeSkillset: "senior-swe",
        installDir: testHomeDir,
      }),
    );

    await currentSkillsetMain({ agent: null });

    // Should output the skillset name via stdout.write
    expect(mockStdoutWrite).toHaveBeenCalledWith("senior-swe\n");
    expect(mockExit).not.toHaveBeenCalled();
  });

  it("should error when no config file exists", async () => {
    // No config file created

    await currentSkillsetMain({ agent: null });

    expect(log.error).toHaveBeenCalledWith(
      expect.stringContaining("No active skillset"),
    );
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("should error when config exists but no active skillset is configured", async () => {
    // Config with no agents
    const configPath = path.join(testHomeDir, ".nori-config.json");
    await fs.writeFile(
      configPath,
      JSON.stringify({
        activeSkillset: null,
        installDir: testHomeDir,
      }),
    );

    await currentSkillsetMain({ agent: null });

    expect(log.error).toHaveBeenCalledWith(
      expect.stringContaining("No active skillset"),
    );
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("should use specified agent when --agent option is provided", async () => {
    // Config with multiple agents
    const configPath = path.join(testHomeDir, ".nori-config.json");
    await fs.writeFile(
      configPath,
      JSON.stringify({
        activeSkillset: "senior-swe",
        installDir: testHomeDir,
      }),
    );

    await currentSkillsetMain({
      agent: "custom-agent",
    });

    // Should output the custom agent's skillset
    expect(mockStdoutWrite).toHaveBeenCalledWith("senior-swe\n");
    expect(mockExit).not.toHaveBeenCalled();
  });

  it("should use first installed agent when no agent is specified", async () => {
    // Config with activeSkillset - should be used regardless of agent
    const configPath = path.join(testHomeDir, ".nori-config.json");
    await fs.writeFile(
      configPath,
      JSON.stringify({
        activeSkillset: "senior-swe",
        installDir: testHomeDir,
      }),
    );

    await currentSkillsetMain({ agent: null });

    // Should output the active skillset
    expect(mockStdoutWrite).toHaveBeenCalledWith("senior-swe\n");
    expect(mockExit).not.toHaveBeenCalled();
  });

  it("should handle namespaced skillset names correctly", async () => {
    // Config with namespaced profile
    const configPath = path.join(testHomeDir, ".nori-config.json");
    await fs.writeFile(
      configPath,
      JSON.stringify({
        activeSkillset: "myorg/my-profile",
        installDir: testHomeDir,
      }),
    );

    await currentSkillsetMain({ agent: null });

    // Should output the namespaced skillset name
    expect(mockStdoutWrite).toHaveBeenCalledWith("myorg/my-profile\n");
    expect(mockExit).not.toHaveBeenCalled();
  });

  it("displays the namespaced identity when the active skillset lives in a bucket", async () => {
    const configPath = path.join(testHomeDir, ".nori-config.json");
    await fs.writeFile(
      configPath,
      JSON.stringify({
        activeSkillset: "senior-swe",
        installDir: testHomeDir,
      }),
    );
    // The stored bare name resolves to the public bucket on disk.
    const publicProfile = path.join(
      testHomeDir,
      ".nori",
      "profiles",
      "public",
      "senior-swe",
    );
    await fs.mkdir(publicProfile, { recursive: true });
    await fs.writeFile(
      path.join(publicProfile, "nori.json"),
      JSON.stringify({ name: "senior-swe", version: "1.0.0" }),
    );

    await currentSkillsetMain({ agent: null });

    expect(mockStdoutWrite).toHaveBeenCalledWith("public/senior-swe\n");
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

    expect(log.error).toHaveBeenCalledWith(
      expect.stringContaining("No active skillset"),
    );
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  describe("with --install-dir", () => {
    it("reports the skillset from .nori-managed at that directory", async () => {
      // Global config still names a different skillset — -d must not read it.
      const configPath = path.join(testHomeDir, ".nori-config.json");
      await fs.writeFile(
        configPath,
        JSON.stringify({
          activeSkillset: "demo/sessions",
          installDir: testHomeDir,
        }),
      );

      const workspace = path.join(testHomeDir, "org", "workspace");
      const claudeDir = path.join(workspace, ".claude");
      await fs.mkdir(claudeDir, { recursive: true });
      await fs.writeFile(
        path.join(claudeDir, ".nori-managed"),
        "demo/high-autonomy",
      );

      await currentSkillsetMain({
        agent: null,
        installDir: workspace,
      });

      expect(mockStdoutWrite).toHaveBeenCalledWith("demo/high-autonomy\n");
      expect(mockExit).not.toHaveBeenCalled();
    });

    it("does not walk parent directories (unlike list-active)", async () => {
      const parentClaude = path.join(testHomeDir, ".claude");
      await fs.mkdir(parentClaude, { recursive: true });
      await fs.writeFile(
        path.join(parentClaude, ".nori-managed"),
        "public/sessions-platform",
      );

      const child = path.join(testHomeDir, "workspace");
      await fs.mkdir(child, { recursive: true });

      await currentSkillsetMain({ agent: null, installDir: child });

      expect(log.error).toHaveBeenCalledWith(
        expect.stringContaining("No skillset installed"),
      );
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it("errors when agents at the directory disagree", async () => {
      const claudeDir = path.join(testHomeDir, ".claude");
      const cursorDir = path.join(testHomeDir, ".cursor");
      await fs.mkdir(claudeDir, { recursive: true });
      await fs.mkdir(cursorDir, { recursive: true });
      await fs.writeFile(path.join(claudeDir, ".nori-managed"), "skillset-a");
      await fs.writeFile(path.join(cursorDir, ".nori-managed"), "skillset-b");

      await currentSkillsetMain({ agent: null, installDir: testHomeDir });

      expect(log.error).toHaveBeenCalledWith(
        expect.stringContaining("Conflicting skillset markers"),
      );
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it("limits the read to --agent when provided", async () => {
      const claudeDir = path.join(testHomeDir, ".claude");
      const cursorDir = path.join(testHomeDir, ".cursor");
      await fs.mkdir(claudeDir, { recursive: true });
      await fs.mkdir(cursorDir, { recursive: true });
      await fs.writeFile(
        path.join(claudeDir, ".nori-managed"),
        "demo/high-autonomy",
      );
      await fs.writeFile(path.join(cursorDir, ".nori-managed"), "demo/other");

      await currentSkillsetMain({
        agent: "claude-code",
        installDir: testHomeDir,
      });

      expect(mockStdoutWrite).toHaveBeenCalledWith("demo/high-autonomy\n");
      expect(mockExit).not.toHaveBeenCalled();
    });
  });
});
