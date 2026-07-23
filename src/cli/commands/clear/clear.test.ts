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

import { loadConfig } from "@/cli/config.js";
import { AgentRegistry } from "@/cli/features/agentRegistry.js";
import { withInstallLock } from "@/cli/features/install/installLock.js";
import { saveTestingConfig } from "@/cli/test-utils/config.js";

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
    await saveTestingConfig({
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

  it("does not clear files while another mutation owns the lock", async () => {
    await saveTestingConfig({
      username: null,
      organizationUrl: null,
      activeSkillset: "senior-swe",
      installDir: tempDir,
    });
    const markerPath = path.join(tempDir, ".claude", ".nori-managed");
    await fs.writeFile(markerPath, "senior-swe");

    let release!: () => void;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const canFinish = new Promise<void>((resolve) => {
      release = resolve;
    });
    const holder = withInstallLock({
      operation: async () => {
        markStarted();
        await canFinish;
      },
    });
    await started;

    try {
      await expect(clearMain()).rejects.toThrow(
        /another Nori installation is already in progress/i,
      );
      await expect(fs.readFile(markerPath, "utf8")).resolves.toBe("senior-swe");
      expect((await loadConfig())?.activeSkillset).toBe("senior-swe");
    } finally {
      release();
      await holder;
    }
  });

  it("should handle case when no config exists", async () => {
    const { log } = await import("@clack/prompts");

    await clearMain({ installDir: tempDir });

    // Should log that there's nothing to clear
    expect(log.info).toHaveBeenCalledWith(
      expect.stringContaining("No Nori configuration found"),
    );
  });

  it("should restore home-level settings.json from backup when installDir differs from home", async () => {
    // Create a separate installDir that is different from home (tempDir)
    const installDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "clear-install-"),
    );

    try {
      // Set up config with a custom installDir
      await saveTestingConfig({
        username: null,
        organizationUrl: null,
        activeSkillset: "test-skillset",
        installDir,
      });

      // Create the install-dir-level agent files
      const installClaudeDir = path.join(installDir, ".claude");
      await fs.mkdir(installClaudeDir, { recursive: true });
      await fs.writeFile(
        path.join(installClaudeDir, ".nori-managed"),
        "test-skillset",
      );
      await fs.writeFile(
        path.join(installClaudeDir, "CLAUDE.md"),
        "# BEGIN NORI-AI MANAGED BLOCK\ntest\n# END NORI-AI MANAGED BLOCK",
      );

      // Write manifest for the install dir
      const manifestDir = path.join(tempDir, ".nori", "manifests");
      await fs.mkdir(manifestDir, { recursive: true });
      await fs.writeFile(
        path.join(manifestDir, "claude-code.json"),
        JSON.stringify({
          skillsetName: "test-skillset",
          files: {
            "CLAUDE.md": "somehash",
          },
        }),
      );

      // Simulate home-level settings.json with nori keys added
      const homeClaudeDir = path.join(tempDir, ".claude");
      await fs.mkdir(homeClaudeDir, { recursive: true });
      const homeSettings = {
        $schema: "https://json.schemastore.org/claude-code-settings.json",
        hooks: { SessionStart: [{ matcher: "", hooks: [] }] },
        statusLine: { type: "command", command: "test", padding: 0 },
        companyAnnouncements: ["test"],
        includeCoAuthoredBy: false,
        userSetting: "preserved",
      };
      await fs.writeFile(
        path.join(homeClaudeDir, "settings.json"),
        JSON.stringify(homeSettings, null, 2),
      );

      // Simulate the backup that would have been created during install
      const originalSettings = {
        $schema: "https://json.schemastore.org/claude-code-settings.json",
        userSetting: "preserved",
      };
      await fs.writeFile(
        path.join(homeClaudeDir, "settings.json.pre-nori"),
        JSON.stringify(originalSettings, null, 2),
      );

      // Create nori-statusline.sh at home level
      await fs.writeFile(
        path.join(homeClaudeDir, "nori-statusline.sh"),
        "#!/bin/bash\necho test",
      );

      await clearMain({ installDir });

      // Verify home-level settings.json was restored from backup
      const content = await fs.readFile(
        path.join(homeClaudeDir, "settings.json"),
        "utf-8",
      );
      const settings = JSON.parse(content);
      expect(settings.hooks).toBeUndefined();
      expect(settings.statusLine).toBeUndefined();
      expect(settings.companyAnnouncements).toBeUndefined();
      expect(settings.includeCoAuthoredBy).toBeUndefined();
      expect(settings.userSetting).toBe("preserved");

      // Verify backup was cleaned up
      const backupExists = await fs
        .access(path.join(homeClaudeDir, "settings.json.pre-nori"))
        .then(() => true)
        .catch(() => false);
      expect(backupExists).toBe(false);

      // Verify nori-statusline.sh was deleted
      const statuslineExists = await fs
        .access(path.join(homeClaudeDir, "nori-statusline.sh"))
        .then(() => true)
        .catch(() => false);
      expect(statuslineExists).toBe(false);
    } finally {
      await fs.rm(installDir, { recursive: true, force: true });
    }
  });
});
