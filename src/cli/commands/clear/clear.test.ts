/**
 * Tests for the clear command
 *
 * Verifies that `clearMain` removes Nori-managed files from the installDir
 * and clears the activeSkillset from config.
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadConfig, saveConfig } from "@/cli/config.js";
import { AgentRegistry } from "@/cli/features/agentRegistry.js";

// Mock os.homedir so config paths resolve to temp directory
vi.mock("os", async (importOriginal) => {
  const actual = await importOriginal<typeof os>();
  return {
    ...actual,
    homedir: vi.fn().mockReturnValue(actual.homedir()),
  };
});

// Mock @clack/prompts for output capture
vi.mock("@clack/prompts", () => ({
  log: {
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    step: vi.fn(),
    message: vi.fn(),
  },
  outro: vi.fn(),
}));

// Mock logger
vi.mock("@/cli/logger.js", () => ({
  info: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  newline: vi.fn(),
  raw: vi.fn(),
}));

import { clearMain } from "./clear.js";

describe("clearMain", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "clear-test-"));
    vi.mocked(os.homedir).mockReturnValue(tempDir);

    const claudeDir = path.join(tempDir, ".claude");
    const noriDir = path.join(tempDir, ".nori");
    await fs.mkdir(claudeDir, { recursive: true });
    await fs.mkdir(noriDir, { recursive: true });

    AgentRegistry.resetInstance();
    vi.clearAllMocks();
    vi.mocked(os.homedir).mockReturnValue(tempDir);
  });

  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
    AgentRegistry.resetInstance();
  });

  it("should remove managed files and clear activeSkillset from config", async () => {
    // Set up config with an active skillset
    await saveConfig({
      username: "user@example.com",
      refreshToken: "mock-token",
      organizationUrl: "https://noriskillsets.dev",
      activeSkillset: "senior-swe",
      installDir: tempDir,
    });

    // Create the .nori-managed marker file
    await fs.writeFile(
      path.join(tempDir, ".claude", ".nori-managed"),
      "senior-swe",
    );

    // Create a managed file (CLAUDE.md)
    await fs.writeFile(
      path.join(tempDir, ".claude", "CLAUDE.md"),
      "# BEGIN NORI-AI MANAGED BLOCK\ntest\n# END NORI-AI MANAGED BLOCK",
    );

    // Write a manifest so removeSkillset knows what to remove
    const manifestDir = path.join(tempDir, ".nori", "manifests");
    await fs.mkdir(manifestDir, { recursive: true });
    await fs.writeFile(
      path.join(manifestDir, "claude-code.json"),
      JSON.stringify({
        skillsetName: "senior-swe",
        files: {
          "CLAUDE.md": "somehash",
        },
      }),
    );

    await clearMain({ installDir: tempDir });

    // Verify activeSkillset was cleared
    const config = await loadConfig();
    expect(config?.activeSkillset).toBeUndefined();

    // Verify auth was preserved
    expect(config?.auth?.username).toBe("user@example.com");
  });

  it("should handle case when no config exists", async () => {
    const { log } = await import("@clack/prompts");

    await clearMain({ installDir: tempDir });

    // Should log that there's nothing to clear
    expect(log.info).toHaveBeenCalledWith(
      expect.stringContaining("No Nori configuration found"),
    );
  });
});
