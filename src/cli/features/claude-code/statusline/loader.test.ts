/**
 * Tests for statusline feature loader
 * Verifies install and uninstall operations
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import type { Config } from "@/cli/config.js";

// Mock the env module to use temp directories
let mockClaudeDir: string;
let mockClaudeSettingsFile: string;

vi.mock("@/cli/features/claude-code/paths.js", () => ({
  getClaudeDir: () => mockClaudeDir,
  getClaudeSettingsFile: () => mockClaudeSettingsFile,
  getClaudeHomeDir: () => mockClaudeDir,
  getClaudeHomeSettingsFile: () => mockClaudeSettingsFile,
  getClaudeAgentsDir: () => path.join(mockClaudeDir, "agents"),
  getClaudeCommandsDir: () => path.join(mockClaudeDir, "commands"),
  getClaudeMdFile: () => path.join(mockClaudeDir, "CLAUDE.md"),
  getClaudeSkillsDir: () => path.join(mockClaudeDir, "skills"),
  getClaudeProfilesDir: () => path.join(mockClaudeDir, "profiles"),
}));

// Import loader after mocking env
import { statuslineLoader } from "./loader.js";

describe("statuslineLoader", () => {
  let tempDir: string;
  let claudeDir: string;
  let settingsPath: string;
  let originalHome: string | undefined;

  beforeEach(async () => {
    // Create temp directory for testing
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "statusline-test-"));
    claudeDir = path.join(tempDir, ".claude");
    settingsPath = path.join(claudeDir, "settings.json");

    // Set mock paths
    mockClaudeDir = claudeDir;
    mockClaudeSettingsFile = settingsPath;

    // Mock HOME environment variable to isolate nori-config.json
    originalHome = process.env.HOME;
    process.env.HOME = tempDir;

    // Create directories
    await fs.mkdir(claudeDir, { recursive: true });
  });

  afterEach(async () => {
    // Restore HOME environment variable
    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    }

    // Clean up temp directory
    await fs.rm(tempDir, { recursive: true, force: true });

    // Clear all mocks
    vi.clearAllMocks();
  });

  describe("run", () => {
    it("should create settings.json with statusLine configuration", async () => {
      const config: Config = { installDir: tempDir };

      await statuslineLoader.run({ config });

      // Verify settings.json exists
      const exists = await fs
        .access(settingsPath)
        .then(() => true)
        .catch(() => false);

      expect(exists).toBe(true);

      // Read and parse settings
      const content = await fs.readFile(settingsPath, "utf-8");
      const settings = JSON.parse(content);

      // Verify statusLine is configured
      expect(settings.statusLine).toBeDefined();
      expect(settings.statusLine.type).toBe("command");
      expect(settings.statusLine.command).toBeDefined();
      expect(settings.statusLine.padding).toBeDefined();
    });

    it("should preserve existing settings when adding statusLine", async () => {
      const config: Config = { installDir: tempDir };

      // Create settings.json with existing content
      const existingSettings = {
        $schema: "https://json.schemastore.org/claude-code-settings.json",
        someOtherSetting: "value",
      };
      await fs.writeFile(
        settingsPath,
        JSON.stringify(existingSettings, null, 2),
      );

      await statuslineLoader.run({ config });

      // Read and parse settings
      const content = await fs.readFile(settingsPath, "utf-8");
      const settings = JSON.parse(content);

      // Verify existing settings are preserved
      expect(settings.someOtherSetting).toBe("value");
      expect(settings.$schema).toBe(
        "https://json.schemastore.org/claude-code-settings.json",
      );

      // Verify statusLine is added
      expect(settings.statusLine).toBeDefined();
    });

    it("should update statusLine if already configured", async () => {
      const config: Config = { installDir: tempDir };

      // First installation
      await statuslineLoader.run({ config });

      // Second installation (update)
      await statuslineLoader.run({ config });

      // Read updated statusLine
      const content = await fs.readFile(settingsPath, "utf-8");
      const settings = JSON.parse(content);

      // Verify statusLine still exists
      expect(settings.statusLine).toBeDefined();
      expect(settings.statusLine.type).toBe("command");
    });
  });

  describe("script copying", () => {
    it("should copy script to .claude directory", async () => {
      const config: Config = { installDir: claudeDir };

      await statuslineLoader.run({ config });

      // Verify script was copied to .claude directory
      const copiedScriptPath = path.join(claudeDir, "nori-statusline.sh");
      const exists = await fs
        .access(copiedScriptPath)
        .then(() => true)
        .catch(() => false);

      expect(exists).toBe(true);

      // Verify script contains upward search logic
      const scriptContent = await fs.readFile(copiedScriptPath, "utf-8");
      expect(scriptContent).toContain("find_install_dir");
      expect(scriptContent).toContain(".nori-config.json");
    });

    it("should point settings.json to copied script in .claude directory", async () => {
      const config: Config = { installDir: claudeDir };

      await statuslineLoader.run({ config });

      // Read settings.json
      const content = await fs.readFile(settingsPath, "utf-8");
      const settings = JSON.parse(content);

      // Verify command points to copied script in .claude directory
      const expectedScriptPath = path.join(claudeDir, "nori-statusline.sh");
      expect(settings.statusLine.command).toBe(expectedScriptPath);
    });
  });

  describe("subdirectory detection", () => {
    it("should show branding without upgrade link when running from subdirectory", async () => {
      const config: Config = { installDir: claudeDir };

      // Install statusline
      await statuslineLoader.run({ config });

      // Create mock .nori-config.json in install root
      const noriConfigPath = path.join(tempDir, ".nori-config.json");
      const noriConfigContent = JSON.stringify({});
      await fs.writeFile(noriConfigPath, noriConfigContent);

      // Create subdirectory
      const subdir = path.join(tempDir, "foo", "bar");
      await fs.mkdir(subdir, { recursive: true });

      try {
        // Read settings to get the statusLine command
        const content = await fs.readFile(settingsPath, "utf-8");
        const settings = JSON.parse(content);
        const statusLineCommand = settings.statusLine.command;

        // Execute the statusline script with cwd pointing to subdirectory
        const { execSync } = await import("child_process");
        const mockInput = JSON.stringify({
          cwd: subdir,
          cost: {
            total_cost_usd: 1.5,
            total_lines_added: 10,
            total_lines_removed: 5,
          },
          transcript_path: "",
        });

        const output = execSync(statusLineCommand, {
          input: mockInput,
          encoding: "utf-8",
        });

        // Verify output contains branding without upgrade link
        expect(output).toContain("Augmented with Nori");
        expect(output).not.toContain("upgrade");
      } finally {
        // Clean up
        await fs.rm(noriConfigPath, { force: true });
      }
    });
  });

  describe("statusline script", () => {
    it("should include profile name in output when nori-config.json exists", async () => {
      const config: Config = { installDir: claudeDir };

      // Install statusline
      await statuslineLoader.run({ config });

      // Create mock .nori-config.json with profile in temp directory (install root)
      const noriConfigPath = path.join(tempDir, ".nori-config.json");
      const noriConfigContent = JSON.stringify({
        profile: { baseProfile: "amol" },
      });
      await fs.writeFile(noriConfigPath, noriConfigContent);

      try {
        // Read settings to get the statusLine command
        const content = await fs.readFile(settingsPath, "utf-8");
        const settings = JSON.parse(content);
        const statusLineCommand = settings.statusLine.command;

        // Execute the statusline script with mock input
        const { execSync } = await import("child_process");
        const mockInput = JSON.stringify({
          cwd: tempDir,
          cost: {
            total_cost_usd: 1.5,
            total_lines_added: 10,
            total_lines_removed: 5,
          },
          transcript_path: "",
        });

        const output = execSync(statusLineCommand, {
          input: mockInput,
          encoding: "utf-8",
        });

        // Verify output contains skillset name
        expect(output).toContain("Skillset: amol");
      } finally {
        // Clean up nori-config.json
        await fs.rm(noriConfigPath, { force: true });
      }
    });

    it("should not show profile when nori-config.json does not exist", async () => {
      const config: Config = { installDir: claudeDir };

      // Install statusline
      await statuslineLoader.run({ config });

      // Ensure nori-config.json does not exist in temp directory
      const noriConfigPath = path.join(tempDir, "nori-config.json");
      await fs.rm(noriConfigPath, { force: true });

      try {
        // Read settings to get the statusLine command
        const content = await fs.readFile(settingsPath, "utf-8");
        const settings = JSON.parse(content);
        const statusLineCommand = settings.statusLine.command;

        // Execute the statusline script with mock input
        const { execSync } = await import("child_process");
        const mockInput = JSON.stringify({
          cwd: tempDir,
          cost: {
            total_cost_usd: 1.5,
            total_lines_added: 10,
            total_lines_removed: 5,
          },
          transcript_path: "",
        });

        const output = execSync(statusLineCommand, {
          input: mockInput,
          encoding: "utf-8",
        });

        // Verify output does not contain skillset
        expect(output).not.toContain("Skillset:");
      } finally {
        // Restore nori-config.json if it existed
        // (No cleanup needed as we're in test environment)
      }
    });

    it("should display single nori-ai-cli promotion tip", async () => {
      const config: Config = { installDir: claudeDir };

      // Install statusline
      await statuslineLoader.run({ config });

      // Read settings to get the statusLine command
      const content = await fs.readFile(settingsPath, "utf-8");
      const settings = JSON.parse(content);
      const statusLineCommand = settings.statusLine.command;

      // Execute the statusline script with mock input
      const { execSync } = await import("child_process");
      const mockInput = JSON.stringify({
        cwd: tempDir,
        cost: {
          total_cost_usd: 1.5,
          total_lines_added: 10,
          total_lines_removed: 5,
        },
        transcript_path: "",
      });

      const output = execSync(statusLineCommand, {
        input: mockInput,
        encoding: "utf-8",
      });

      // Verify output contains the single promotional tip
      expect(output).toContain("npm install -g nori-ai-cli");
      // Verify it does NOT have the old "Nori Tip:" prefix
      expect(output).not.toContain("Nori Tip:");
    });

    it("should display jq missing warning when jq is not available", async () => {
      const config: Config = { installDir: claudeDir };

      // Install statusline
      await statuslineLoader.run({ config });

      // Read the statusline script content
      const copiedScriptPath = path.join(claudeDir, "nori-statusline.sh");
      const scriptContent = await fs.readFile(copiedScriptPath, "utf-8");

      // Create a wrapper script that makes jq unavailable by redefining command
      // We use a function override since PATH manipulation may not be reliable in all environments
      const wrapperScript = `#!/bin/bash
# Override 'command' builtin to make jq appear unavailable
command() {
  if [ "\$1" = "-v" ] && [ "\$2" = "jq" ]; then
    return 1
  fi
  builtin command "\$@"
}

${scriptContent}
`;
      const wrapperPath = path.join(tempDir, "test-no-jq.sh");
      await fs.writeFile(wrapperPath, wrapperScript);
      await fs.chmod(wrapperPath, 0o755);

      // Execute wrapper script
      const { execSync } = await import("child_process");
      const mockInput = JSON.stringify({
        cwd: tempDir,
        cost: {
          total_cost_usd: 0,
          total_lines_added: 0,
          total_lines_removed: 0,
        },
        transcript_path: "",
      });

      const output = execSync(`bash ${wrapperPath}`, {
        input: mockInput,
        encoding: "utf-8",
      });

      // Verify the specific warning message content
      expect(output).toContain("Nori statusline requires jq");
      expect(output).toContain("brew install jq");
      expect(output).toContain("apt install jq");
      // Should still show Nori branding
      expect(output).toContain("Augmented with Nori");
    });
  });

  describe("uninstall", () => {
    it("should remove statusLine from settings.json", async () => {
      const config: Config = { installDir: tempDir };

      // Install first
      await statuslineLoader.run({ config });

      // Verify statusLine exists
      let content = await fs.readFile(settingsPath, "utf-8");
      let settings = JSON.parse(content);
      expect(settings.statusLine).toBeDefined();

      // Uninstall
      await statuslineLoader.uninstall({ config });

      // Verify statusLine is removed
      content = await fs.readFile(settingsPath, "utf-8");
      settings = JSON.parse(content);
      expect(settings.statusLine).toBeUndefined();
    });

    it("should preserve other settings when removing statusLine", async () => {
      const config: Config = { installDir: tempDir };

      // Create settings with statusLine and other content
      await statuslineLoader.run({ config });

      let content = await fs.readFile(settingsPath, "utf-8");
      let settings = JSON.parse(content);
      settings.someOtherSetting = "preserved value";
      await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));

      // Uninstall
      await statuslineLoader.uninstall({ config });

      // Verify other settings are preserved
      content = await fs.readFile(settingsPath, "utf-8");
      settings = JSON.parse(content);
      expect(settings.someOtherSetting).toBe("preserved value");
      expect(settings.statusLine).toBeUndefined();
    });

    it("should handle missing settings.json gracefully", async () => {
      const config: Config = { installDir: tempDir };

      // Uninstall without installing first
      await expect(
        statuslineLoader.uninstall({ config }),
      ).resolves.not.toThrow();
    });

    it("should handle settings.json without statusLine gracefully", async () => {
      const config: Config = { installDir: tempDir };

      // Create settings.json without statusLine
      const settings = {
        $schema: "https://json.schemastore.org/claude-code-settings.json",
      };
      await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));

      // Uninstall
      await expect(
        statuslineLoader.uninstall({ config }),
      ).resolves.not.toThrow();

      // Verify settings.json still exists and is unchanged
      const content = await fs.readFile(settingsPath, "utf-8");
      const updatedSettings = JSON.parse(content);
      expect(updatedSettings.$schema).toBe(
        "https://json.schemastore.org/claude-code-settings.json",
      );
    });
  });
});
