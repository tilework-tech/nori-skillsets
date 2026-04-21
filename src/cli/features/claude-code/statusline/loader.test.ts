/**
 * Tests for statusline feature loader
 * Verifies install operations
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
  getClaudeHomeDir: () => mockClaudeDir,
  getClaudeHomeSettingsFile: () => mockClaudeSettingsFile,
  getClaudeHomeCommandsDir: () => path.join(mockClaudeDir, "commands"),
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

    // Clean up temp directory and session tracking files scoped to this test's tempDir
    const { execSync } = await import("child_process");
    try {
      const hash = execSync(`echo "${tempDir}" | md5sum | cut -d' ' -f1`, {
        encoding: "utf-8",
      }).trim();
      await fs.rm(`/tmp/nori-statusline-session-${hash}`, { force: true });
    } catch {
      // Ignore cleanup failures
    }
    await fs.rm(tempDir, { recursive: true, force: true });

    // Clear all mocks
    vi.clearAllMocks();
  });

  describe("run", () => {
    it("should create settings.json with statusLine configuration", async () => {
      const config: Config = { installDir: tempDir };

      await statuslineLoader.run({ agent: {} as any, config });

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

      await statuslineLoader.run({ agent: {} as any, config });

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
      await statuslineLoader.run({ agent: {} as any, config });

      // Second installation (update)
      await statuslineLoader.run({ agent: {} as any, config });

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

      await statuslineLoader.run({ agent: {} as any, config });

      // Verify script was copied to .claude directory
      const copiedScriptPath = path.join(claudeDir, "nori-statusline.sh");
      const exists = await fs
        .access(copiedScriptPath)
        .then(() => true)
        .catch(() => false);

      expect(exists).toBe(true);

      // Verify script contains config reading logic
      const scriptContent = await fs.readFile(copiedScriptPath, "utf-8");
      expect(scriptContent).toContain(".nori-config.json");
    });

    it("should point settings.json to copied script in .claude directory", async () => {
      const config: Config = { installDir: claudeDir };

      await statuslineLoader.run({ agent: {} as any, config });

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
      await statuslineLoader.run({ agent: {} as any, config });

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
    it("should include skillset name in output when nori-config.json exists", async () => {
      const config: Config = { installDir: claudeDir };

      // Install statusline
      await statuslineLoader.run({ agent: {} as any, config });

      // Create mock .nori-config.json with skillset in temp directory (install root)
      const noriConfigPath = path.join(tempDir, ".nori-config.json");
      const noriConfigContent = JSON.stringify({
        activeSkillset: "amol",
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

    it("should not show skillset when nori-config.json does not exist", async () => {
      const config: Config = { installDir: claudeDir };

      // Install statusline
      await statuslineLoader.run({ agent: {} as any, config });

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

    it("should display single nori-skillsets promotion tip", async () => {
      const config: Config = { installDir: claudeDir };

      // Install statusline
      await statuslineLoader.run({ agent: {} as any, config });

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
      expect(output).toContain("npm install -g nori-skillsets");
      // Verify it does NOT have the old "Nori Tip:" prefix
      expect(output).not.toContain("Nori Tip:");
    });

    it("should display version from nori-config.json in branding line", async () => {
      const config: Config = { installDir: claudeDir };

      // Install statusline
      await statuslineLoader.run({ agent: {} as any, config });

      // Create mock .nori-config.json with version
      const noriConfigPath = path.join(tempDir, ".nori-config.json");
      const noriConfigContent = JSON.stringify({
        version: "1.2.3",
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

        // Verify branding line includes version from config
        expect(output).toContain("Augmented with Nori v1.2.3");
      } finally {
        await fs.rm(noriConfigPath, { force: true });
      }
    });

    it("should display branding without version when nori-config.json has no version field", async () => {
      const config: Config = { installDir: claudeDir };

      // Install statusline
      await statuslineLoader.run({ agent: {} as any, config });

      // Create mock .nori-config.json without version field
      const noriConfigPath = path.join(tempDir, ".nori-config.json");
      const noriConfigContent = JSON.stringify({
        activeSkillset: "test",
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

        // Verify branding line shows without version but no __VERSION__ placeholder
        expect(output).toContain("Augmented with Nori");
        expect(output).not.toContain("__VERSION__");
      } finally {
        await fs.rm(noriConfigPath, { force: true });
      }
    });

    it("should display token count from context_window fields in stdin JSON", async () => {
      const config: Config = { installDir: claudeDir };

      await statuslineLoader.run({ agent: {} as any, config });

      const content = await fs.readFile(settingsPath, "utf-8");
      const settings = JSON.parse(content);
      const statusLineCommand = settings.statusLine.command;

      const { execSync } = await import("child_process");
      const mockInput = JSON.stringify({
        cwd: tempDir,
        session_id: "test-session-1",
        cost: {
          total_cost_usd: 0.5,
          total_lines_added: 10,
          total_lines_removed: 5,
        },
        context_window: {
          total_input_tokens: 25000,
          total_output_tokens: 5000,
        },
        transcript_path: "",
      });

      const output = execSync(statusLineCommand, {
        input: mockInput,
        encoding: "utf-8",
      });

      // 25000 + 5000 = 30000 = 30k
      expect(output).toContain("Tokens: 30.0k");
    });

    it("should display context length from context_window.current_usage fields", async () => {
      const config: Config = { installDir: claudeDir };

      await statuslineLoader.run({ agent: {} as any, config });

      const content = await fs.readFile(settingsPath, "utf-8");
      const settings = JSON.parse(content);
      const statusLineCommand = settings.statusLine.command;

      const { execSync } = await import("child_process");
      const mockInput = JSON.stringify({
        cwd: tempDir,
        session_id: "test-session-1",
        cost: {
          total_cost_usd: 0.5,
          total_lines_added: 10,
          total_lines_removed: 5,
        },
        context_window: {
          total_input_tokens: 50000,
          total_output_tokens: 10000,
          current_usage: {
            input_tokens: 15000,
            cache_read_input_tokens: 5000,
            cache_creation_input_tokens: 2000,
            output_tokens: 3000,
          },
        },
        transcript_path: "",
      });

      const output = execSync(statusLineCommand, {
        input: mockInput,
        encoding: "utf-8",
      });

      // Context = input + cache_read + cache_creation = 15000 + 5000 + 2000 = 22000 = 22k
      expect(output).toContain("Context: 22.0k");
    });

    it("should default tokens and context to 0 when context_window fields are missing", async () => {
      const config: Config = { installDir: claudeDir };

      await statuslineLoader.run({ agent: {} as any, config });

      const content = await fs.readFile(settingsPath, "utf-8");
      const settings = JSON.parse(content);
      const statusLineCommand = settings.statusLine.command;

      const { execSync } = await import("child_process");
      const mockInput = JSON.stringify({
        cwd: tempDir,
        session_id: "test-session-1",
        cost: {
          total_cost_usd: 0.5,
          total_lines_added: 10,
          total_lines_removed: 5,
        },
        transcript_path: "",
      });

      const output = execSync(statusLineCommand, {
        input: mockInput,
        encoding: "utf-8",
      });

      expect(output).toContain("Tokens: 0");
      expect(output).toContain("Context: 0");
    });

    it("should reset cost and lines when session_id changes", async () => {
      const config: Config = { installDir: claudeDir };

      await statuslineLoader.run({ agent: {} as any, config });

      const content = await fs.readFile(settingsPath, "utf-8");
      const settings = JSON.parse(content);
      const statusLineCommand = settings.statusLine.command;

      const { execSync } = await import("child_process");

      // First session: accumulate some cost
      const firstSessionInput = JSON.stringify({
        cwd: tempDir,
        session_id: "session-1",
        cost: {
          total_cost_usd: 2.5,
          total_lines_added: 50,
          total_lines_removed: 20,
        },
        context_window: {
          total_input_tokens: 100000,
          total_output_tokens: 20000,
        },
        transcript_path: "",
      });

      execSync(statusLineCommand, {
        input: firstSessionInput,
        encoding: "utf-8",
      });

      // Second session (after /clear): cost in stdin is cumulative but session_id changed
      const secondSessionInput = JSON.stringify({
        cwd: tempDir,
        session_id: "session-2",
        cost: {
          total_cost_usd: 2.5,
          total_lines_added: 50,
          total_lines_removed: 20,
        },
        context_window: {
          total_input_tokens: 0,
          total_output_tokens: 0,
        },
        transcript_path: "",
      });

      const output = execSync(statusLineCommand, {
        input: secondSessionInput,
        encoding: "utf-8",
      });

      // Cost should show $0.00 because session changed and baseline was $2.50
      expect(output).toContain("Cost: $0.00");
      // Lines should show +0/-0
      expect(output).toContain("Lines: +0/-0");
    });

    it("should accumulate cost within the same session", async () => {
      const config: Config = { installDir: claudeDir };

      await statuslineLoader.run({ agent: {} as any, config });

      const content = await fs.readFile(settingsPath, "utf-8");
      const settings = JSON.parse(content);
      const statusLineCommand = settings.statusLine.command;

      const { execSync } = await import("child_process");

      // Ensure clean session state
      const cleanSessionInput = JSON.stringify({
        cwd: tempDir,
        session_id: "session-accumulate",
        cost: {
          total_cost_usd: 0,
          total_lines_added: 0,
          total_lines_removed: 0,
        },
        context_window: {
          total_input_tokens: 0,
          total_output_tokens: 0,
        },
        transcript_path: "",
      });

      execSync(statusLineCommand, {
        input: cleanSessionInput,
        encoding: "utf-8",
      });

      // Same session, cost grows
      const laterInput = JSON.stringify({
        cwd: tempDir,
        session_id: "session-accumulate",
        cost: {
          total_cost_usd: 1.75,
          total_lines_added: 30,
          total_lines_removed: 10,
        },
        context_window: {
          total_input_tokens: 50000,
          total_output_tokens: 10000,
        },
        transcript_path: "",
      });

      const output = execSync(statusLineCommand, {
        input: laterInput,
        encoding: "utf-8",
      });

      // Cost should show $1.75 (same session, no reset)
      expect(output).toContain("Cost: $1.75");
      expect(output).toContain("Lines: +30/-10");
    });

    it("should display jq missing warning when jq is not available", async () => {
      const config: Config = { installDir: claudeDir };

      // Install statusline
      await statuslineLoader.run({ agent: {} as any, config });

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
});
