/**
 * Tests for permissionsLoader
 * Verifies that the loader correctly adds profiles and skills directories
 * to Claude Code's settings.json permissions.additionalDirectories
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import type { Config } from "@/cli/config.js";
import type { AgentConfig } from "@/cli/features/agentRegistry.js";

// Mock paths to use test directories
const TEST_NORI_DIR = "/tmp/permissions-loader-test-nori";

vi.mock("@/cli/features/paths.js", () => ({
  getNoriDir: () => TEST_NORI_DIR,
  getNoriSkillsetsDir: () => `${TEST_NORI_DIR}/profiles`,
}));

// Mock os.homedir
vi.mock("os", async (importOriginal) => {
  const actual = await importOriginal<typeof os>();
  return {
    ...actual,
    homedir: vi.fn().mockReturnValue(actual.homedir()),
  };
});

describe("permissionsLoader", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "permissions-loader-test-"),
    );

    // Clean up test nori dir
    try {
      fs.rmSync(TEST_NORI_DIR, { recursive: true, force: true });
    } catch {}
    fs.mkdirSync(`${TEST_NORI_DIR}/profiles`, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    try {
      fs.rmSync(TEST_NORI_DIR, { recursive: true, force: true });
    } catch {}
    vi.clearAllMocks();
  });

  const createTestAgent = (): AgentConfig => ({
    name: "claude-code",
    displayName: "Claude Code",
    description: "Test",
    getAgentDir: ({ installDir }) => path.join(installDir, ".claude"),
    getSkillsDir: ({ installDir }) =>
      path.join(installDir, ".claude", "skills"),
    getSubagentsDir: ({ installDir }) =>
      path.join(installDir, ".claude", "agents"),
    getSlashcommandsDir: ({ installDir }) =>
      path.join(installDir, ".claude", "commands"),
    getInstructionsFilePath: ({ installDir }) =>
      path.join(installDir, ".claude", "CLAUDE.md"),
    getLoaders: () => [],
  });

  it("should create settings.json with permissions when it does not exist", async () => {
    const { permissionsLoader } =
      await import("@/cli/features/claude-code/permissionsLoader.js");

    const agent = createTestAgent();
    const config: Config = { installDir: tempDir };

    await permissionsLoader.run({ agent, config });

    const settingsPath = path.join(tempDir, ".claude", "settings.json");
    expect(fs.existsSync(settingsPath)).toBe(true);

    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    expect(settings.permissions.additionalDirectories).toContain(
      `${TEST_NORI_DIR}/profiles`,
    );
    expect(settings.permissions.additionalDirectories).toContain(
      path.join(tempDir, ".claude", "skills"),
    );
  });

  it("should add directories to existing settings.json without overwriting other settings", async () => {
    const { permissionsLoader } =
      await import("@/cli/features/claude-code/permissionsLoader.js");

    const agent = createTestAgent();
    const config: Config = { installDir: tempDir };

    // Create existing settings.json with some data
    const claudeDir = path.join(tempDir, ".claude");
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(
      path.join(claudeDir, "settings.json"),
      JSON.stringify({
        $schema: "https://json.schemastore.org/claude-code-settings.json",
        includeCoAuthoredBy: false,
      }),
    );

    await permissionsLoader.run({ agent, config });

    const settings = JSON.parse(
      fs.readFileSync(path.join(claudeDir, "settings.json"), "utf-8"),
    );
    // Existing settings preserved
    expect(settings.includeCoAuthoredBy).toBe(false);
    // Permissions added
    expect(settings.permissions.additionalDirectories).toContain(
      `${TEST_NORI_DIR}/profiles`,
    );
  });

  it("should not duplicate directories when run multiple times", async () => {
    const { permissionsLoader } =
      await import("@/cli/features/claude-code/permissionsLoader.js");

    const agent = createTestAgent();
    const config: Config = { installDir: tempDir };

    // Run twice
    await permissionsLoader.run({ agent, config });
    await permissionsLoader.run({ agent, config });

    const settingsPath = path.join(tempDir, ".claude", "settings.json");
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));

    const profilesCount = settings.permissions.additionalDirectories.filter(
      (d: string) => d === `${TEST_NORI_DIR}/profiles`,
    ).length;
    expect(profilesCount).toBe(1);

    const skillsCount = settings.permissions.additionalDirectories.filter(
      (d: string) => d === path.join(tempDir, ".claude", "skills"),
    ).length;
    expect(skillsCount).toBe(1);
  });

  it("should have the correct name and description", async () => {
    const { permissionsLoader } =
      await import("@/cli/features/claude-code/permissionsLoader.js");

    expect(permissionsLoader.name).toBe("permissions");
    expect(permissionsLoader.managedFiles).toContain("settings.json");
  });
});
