/**
 * Tests for the clear-current command
 *
 * Verifies that `clearCurrentMain` walks from a starting directory up to the
 * filesystem root and removes Nori-managed skillsets from every directory
 * where one is detected.
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentRegistry } from "@/cli/features/agentRegistry.js";
import { createHeldInstallLock } from "@/cli/test-utils/installLock.js";

// Mock os.homedir so manifest/config paths resolve to temp directory
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

import { clearCurrentMain } from "./clearCurrent.js";

/**
 * Helper: set up a Nori-managed installation at a given directory.
 * Creates .claude/.nori-managed marker, CLAUDE.md with managed block,
 * and a manifest so removeSkillset knows what to clean.
 * @param args - Installation parameters
 * @param args.dir - Directory to install the skillset at
 * @param args.skillsetName - Name of the skillset to install
 * @param args.homeDir - Home directory for manifest storage
 */
const seedInstallation = async (args: {
  dir: string;
  skillsetName: string;
  homeDir: string;
}): Promise<void> => {
  const { dir, skillsetName, homeDir } = args;

  const claudeDir = path.join(dir, ".claude");
  await fs.mkdir(claudeDir, { recursive: true });
  await fs.writeFile(path.join(claudeDir, ".nori-managed"), skillsetName);
  await fs.writeFile(
    path.join(claudeDir, "CLAUDE.md"),
    "# BEGIN NORI-AI MANAGED BLOCK\ntest\n# END NORI-AI MANAGED BLOCK",
  );

  const manifestDir = path.join(homeDir, ".nori", "manifests");
  await fs.mkdir(manifestDir, { recursive: true });
  await fs.writeFile(
    path.join(manifestDir, "claude-code.json"),
    JSON.stringify({
      skillsetName,
      files: {
        "CLAUDE.md": "somehash",
      },
    }),
  );
};

describe("clearCurrentMain", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "clear-current-test-"));
    vi.mocked(os.homedir).mockReturnValue(tempDir);

    const noriDir = path.join(tempDir, ".nori");
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

  it("should remove managed files from the current directory", async () => {
    await seedInstallation({
      dir: tempDir,
      skillsetName: "senior-swe",
      homeDir: tempDir,
    });

    await clearCurrentMain({ dir: tempDir });

    // .nori-managed marker should be removed
    const markerExists = await fs
      .access(path.join(tempDir, ".claude", ".nori-managed"))
      .then(() => true)
      .catch(() => false);
    expect(markerExists).toBe(false);
  });

  it("rejects a held install lock before removing managed files", async () => {
    await seedInstallation({
      dir: tempDir,
      skillsetName: "senior-swe",
      homeDir: tempDir,
    });
    await createHeldInstallLock({ homeDir: tempDir });
    const markerPath = path.join(tempDir, ".claude", ".nori-managed");

    await expect(clearCurrentMain({ dir: tempDir })).rejects.toThrow(
      /another Nori installation is already in progress/i,
    );

    await expect(fs.readFile(markerPath, "utf8")).resolves.toBe("senior-swe");
  });

  it("should remove managed files from ancestor directories", async () => {
    await seedInstallation({
      dir: tempDir,
      skillsetName: "parent-skillset",
      homeDir: tempDir,
    });

    // Start from a child directory
    const childDir = path.join(tempDir, "projects", "my-app");
    await fs.mkdir(childDir, { recursive: true });

    await clearCurrentMain({ dir: childDir });

    // Parent's .nori-managed should be removed
    const markerExists = await fs
      .access(path.join(tempDir, ".claude", ".nori-managed"))
      .then(() => true)
      .catch(() => false);
    expect(markerExists).toBe(false);
  });

  it("should remove installations at multiple directory levels", async () => {
    // Install at parent level
    await seedInstallation({
      dir: tempDir,
      skillsetName: "parent-skillset",
      homeDir: tempDir,
    });

    // Install at child level
    const childDir = path.join(tempDir, "projects");
    await fs.mkdir(childDir, { recursive: true });
    await seedInstallation({
      dir: childDir,
      skillsetName: "child-skillset",
      homeDir: tempDir,
    });

    await clearCurrentMain({ dir: childDir });

    // Both markers should be removed
    const parentMarker = await fs
      .access(path.join(tempDir, ".claude", ".nori-managed"))
      .then(() => true)
      .catch(() => false);
    const childMarker = await fs
      .access(path.join(childDir, ".claude", ".nori-managed"))
      .then(() => true)
      .catch(() => false);

    expect(parentMarker).toBe(false);
    expect(childMarker).toBe(false);

    // Managed blocks should be stripped from both CLAUDE.md files
    const parentClaude = await fs.readFile(
      path.join(tempDir, ".claude", "CLAUDE.md"),
      "utf-8",
    );
    const childClaude = await fs.readFile(
      path.join(childDir, ".claude", "CLAUDE.md"),
      "utf-8",
    );
    expect(parentClaude).not.toContain("NORI-AI MANAGED BLOCK");
    expect(childClaude).not.toContain("NORI-AI MANAGED BLOCK");
  });

  it("should complete without error when no installations are found", async () => {
    await expect(clearCurrentMain({ dir: tempDir })).resolves.not.toThrow();
  });

  it("should handle mixed directories where only some have installations", async () => {
    // Install at tempDir but not at child
    await seedInstallation({
      dir: tempDir,
      skillsetName: "root-skillset",
      homeDir: tempDir,
    });

    const childDir = path.join(tempDir, "projects");
    await fs.mkdir(childDir, { recursive: true });
    // No installation at childDir

    await clearCurrentMain({ dir: childDir });

    // Parent installation should still be cleared
    const markerExists = await fs
      .access(path.join(tempDir, ".claude", ".nori-managed"))
      .then(() => true)
      .catch(() => false);
    expect(markerExists).toBe(false);
  });
});
