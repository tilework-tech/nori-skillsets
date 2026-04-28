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

const overrideStatuslinePackageRoot = async (args: {
  scriptPath: string;
  packageRoot: string;
}): Promise<void> => {
  const { scriptPath, packageRoot } = args;
  const content = await fs.readFile(scriptPath, "utf-8");
  const newContent = content.replace(
    /NORI_PACKAGE_ROOT="[^"]*"/,
    `NORI_PACKAGE_ROOT="${packageRoot}"`,
  );
  await fs.writeFile(scriptPath, newContent);
};

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

    it("should display version from on-disk package.json", async () => {
      const config: Config = { installDir: claudeDir };

      await statuslineLoader.run({ agent: {} as any, config });

      const fakePackageRoot = path.join(tempDir, "fake-pkg");
      await fs.mkdir(fakePackageRoot, { recursive: true });
      await fs.writeFile(
        path.join(fakePackageRoot, "package.json"),
        JSON.stringify({ name: "nori-skillsets", version: "9.9.9" }),
      );
      const copiedScriptPath = path.join(claudeDir, "nori-statusline.sh");
      await overrideStatuslinePackageRoot({
        scriptPath: copiedScriptPath,
        packageRoot: fakePackageRoot,
      });

      const content = await fs.readFile(settingsPath, "utf-8");
      const settings = JSON.parse(content);
      const statusLineCommand = settings.statusLine.command;

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

      expect(output).toContain("Augmented with Nori v9.9.9");
    });

    it("should prefer on-disk package.json version over stale config version", async () => {
      const config: Config = { installDir: claudeDir };

      await statuslineLoader.run({ agent: {} as any, config });

      const fakePackageRoot = path.join(tempDir, "fake-pkg");
      await fs.mkdir(fakePackageRoot, { recursive: true });
      await fs.writeFile(
        path.join(fakePackageRoot, "package.json"),
        JSON.stringify({ name: "nori-skillsets", version: "2.0.0" }),
      );
      const copiedScriptPath = path.join(claudeDir, "nori-statusline.sh");
      await overrideStatuslinePackageRoot({
        scriptPath: copiedScriptPath,
        packageRoot: fakePackageRoot,
      });

      const noriConfigPath = path.join(tempDir, ".nori-config.json");
      await fs.writeFile(noriConfigPath, JSON.stringify({ version: "1.0.0" }));

      try {
        const content = await fs.readFile(settingsPath, "utf-8");
        const settings = JSON.parse(content);
        const statusLineCommand = settings.statusLine.command;

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

        expect(output).toContain("Augmented with Nori v2.0.0");
        expect(output).not.toContain("v1.0.0");
      } finally {
        await fs.rm(noriConfigPath, { force: true });
      }
    });

    it("should fall back to config version when package.json path is invalid", async () => {
      const config: Config = { installDir: claudeDir };

      await statuslineLoader.run({ agent: {} as any, config });

      const copiedScriptPath = path.join(claudeDir, "nori-statusline.sh");
      await overrideStatuslinePackageRoot({
        scriptPath: copiedScriptPath,
        packageRoot: path.join(tempDir, "does-not-exist"),
      });

      const noriConfigPath = path.join(tempDir, ".nori-config.json");
      await fs.writeFile(noriConfigPath, JSON.stringify({ version: "1.2.3" }));

      try {
        const content = await fs.readFile(settingsPath, "utf-8");
        const settings = JSON.parse(content);
        const statusLineCommand = settings.statusLine.command;

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

        expect(output).toContain("Augmented with Nori v1.2.3");
      } finally {
        await fs.rm(noriConfigPath, { force: true });
      }
    });

    it("should display branding without version when neither package.json nor config has version", async () => {
      const config: Config = { installDir: claudeDir };

      await statuslineLoader.run({ agent: {} as any, config });

      const copiedScriptPath = path.join(claudeDir, "nori-statusline.sh");
      await overrideStatuslinePackageRoot({
        scriptPath: copiedScriptPath,
        packageRoot: path.join(tempDir, "does-not-exist"),
      });

      const noriConfigPath = path.join(tempDir, ".nori-config.json");
      await fs.writeFile(
        noriConfigPath,
        JSON.stringify({ activeSkillset: "test" }),
      );

      try {
        const content = await fs.readFile(settingsPath, "utf-8");
        const settings = JSON.parse(content);
        const statusLineCommand = settings.statusLine.command;

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

        expect(output).toContain("Augmented with Nori");
        expect(output).not.toContain("__VERSION__");
        expect(output).not.toContain("Augmented with Nori v");
      } finally {
        await fs.rm(noriConfigPath, { force: true });
      }
    });

    it("should not show update nag when on-disk package matches latest, even if config is stale", async () => {
      const config: Config = { installDir: claudeDir };

      await statuslineLoader.run({ agent: {} as any, config });

      const fakePackageRoot = path.join(tempDir, "fake-pkg");
      await fs.mkdir(fakePackageRoot, { recursive: true });
      await fs.writeFile(
        path.join(fakePackageRoot, "package.json"),
        JSON.stringify({ name: "nori-skillsets", version: "2.0.0" }),
      );
      const copiedScriptPath = path.join(claudeDir, "nori-statusline.sh");
      await overrideStatuslinePackageRoot({
        scriptPath: copiedScriptPath,
        packageRoot: fakePackageRoot,
      });

      const noriConfigPath = path.join(tempDir, ".nori-config.json");
      await fs.writeFile(noriConfigPath, JSON.stringify({ version: "1.0.0" }));

      const versionCacheDir = path.join(tempDir, ".nori", "profiles");
      await fs.mkdir(versionCacheDir, { recursive: true });
      await fs.writeFile(
        path.join(versionCacheDir, "nori-skillsets-version.json"),
        JSON.stringify({ latest_version: "2.0.0" }),
      );

      try {
        const content = await fs.readFile(settingsPath, "utf-8");
        const settings = JSON.parse(content);
        const statusLineCommand = settings.statusLine.command;

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

        expect(output).not.toContain("Update available");
      } finally {
        await fs.rm(noriConfigPath, { force: true });
        await fs.rm(versionCacheDir, { recursive: true, force: true });
      }
    });

    it("should display token count including cached tokens from current_usage", async () => {
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
          total_input_tokens: 500,
          total_output_tokens: 200,
          current_usage: {
            input_tokens: 500,
            cache_read_input_tokens: 20000,
            cache_creation_input_tokens: 5000,
            output_tokens: 200,
          },
        },
        transcript_path: "",
      });

      const output = execSync(statusLineCommand, {
        input: mockInput,
        encoding: "utf-8",
      });

      // Tokens should include cached: 500 + 20000 + 5000 + 200 = 25700 = 25.7k
      expect(output).toContain("Tokens: 25.7k");
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

    it("should NOT reset cost and lines when session_id changes", async () => {
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
          current_usage: {
            input_tokens: 1000,
            cache_read_input_tokens: 20000,
            cache_creation_input_tokens: 0,
            output_tokens: 500,
          },
        },
        transcript_path: "",
      });

      execSync(statusLineCommand, {
        input: firstSessionInput,
        encoding: "utf-8",
      });

      // Second session (after /clear): cost in stdin is cumulative, session_id changed
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

      // Cost should still show $2.50 (cumulative across user session)
      expect(output).toContain("Cost: $2.50");
      // Lines should still show +50/-20
      expect(output).toContain("Lines: +50/-20");
    });

    it("should persist tokens across /clear (session_id change)", async () => {
      const config: Config = { installDir: claudeDir };

      await statuslineLoader.run({ agent: {} as any, config });

      const content = await fs.readFile(settingsPath, "utf-8");
      const settings = JSON.parse(content);
      const statusLineCommand = settings.statusLine.command;

      const { execSync } = await import("child_process");

      // First session: one API call with 25k total tokens (including cache)
      const firstSessionInput = JSON.stringify({
        cwd: tempDir,
        session_id: "session-persist-1",
        cost: {
          total_cost_usd: 1.0,
          total_lines_added: 10,
          total_lines_removed: 5,
        },
        context_window: {
          total_input_tokens: 500,
          total_output_tokens: 200,
          current_usage: {
            input_tokens: 500,
            cache_read_input_tokens: 20000,
            cache_creation_input_tokens: 5000,
            output_tokens: 200,
          },
        },
        transcript_path: "",
      });

      execSync(statusLineCommand, {
        input: firstSessionInput,
        encoding: "utf-8",
      });

      // After /clear: new session, new API call with 22k total tokens
      const secondSessionInput = JSON.stringify({
        cwd: tempDir,
        session_id: "session-persist-2",
        cost: {
          total_cost_usd: 1.5,
          total_lines_added: 15,
          total_lines_removed: 8,
        },
        context_window: {
          total_input_tokens: 300,
          total_output_tokens: 100,
          current_usage: {
            input_tokens: 300,
            cache_read_input_tokens: 20000,
            cache_creation_input_tokens: 2000,
            output_tokens: 100,
          },
        },
        transcript_path: "",
      });

      const output = execSync(statusLineCommand, {
        input: secondSessionInput,
        encoding: "utf-8",
      });

      // Tokens should be cumulative: 25700 + 22400 = 48100 = 48.1k
      expect(output).toContain("Tokens: 48.1k");
    });

    it("should reset tokens on process restart (cost decreases)", async () => {
      const config: Config = { installDir: claudeDir };

      await statuslineLoader.run({ agent: {} as any, config });

      const content = await fs.readFile(settingsPath, "utf-8");
      const settings = JSON.parse(content);
      const statusLineCommand = settings.statusLine.command;

      const { execSync } = await import("child_process");

      // First process: accumulate tokens with cost $2.00
      const firstProcessInput = JSON.stringify({
        cwd: tempDir,
        session_id: "process-1-session",
        cost: {
          total_cost_usd: 2.0,
          total_lines_added: 100,
          total_lines_removed: 50,
        },
        context_window: {
          total_input_tokens: 1000,
          total_output_tokens: 500,
          current_usage: {
            input_tokens: 1000,
            cache_read_input_tokens: 20000,
            cache_creation_input_tokens: 5000,
            output_tokens: 500,
          },
        },
        transcript_path: "",
      });

      execSync(statusLineCommand, {
        input: firstProcessInput,
        encoding: "utf-8",
      });

      // New process (restart): cost starts low again, new session_id
      const newProcessInput = JSON.stringify({
        cwd: tempDir,
        session_id: "process-2-session",
        cost: {
          total_cost_usd: 0.05,
          total_lines_added: 5,
          total_lines_removed: 2,
        },
        context_window: {
          total_input_tokens: 200,
          total_output_tokens: 100,
          current_usage: {
            input_tokens: 200,
            cache_read_input_tokens: 20000,
            cache_creation_input_tokens: 3000,
            output_tokens: 100,
          },
        },
        transcript_path: "",
      });

      const output = execSync(statusLineCommand, {
        input: newProcessInput,
        encoding: "utf-8",
      });

      // Tokens should reset: only new process tokens = 200 + 20000 + 3000 + 100 = 23300 = 23.3k
      expect(output).toContain("Tokens: 23.3k");
    });

    it("should accumulate tokens across multiple API calls within the same session", async () => {
      const config: Config = { installDir: claudeDir };

      await statuslineLoader.run({ agent: {} as any, config });

      const content = await fs.readFile(settingsPath, "utf-8");
      const settings = JSON.parse(content);
      const statusLineCommand = settings.statusLine.command;

      const { execSync } = await import("child_process");

      // First API call
      const firstCallInput = JSON.stringify({
        cwd: tempDir,
        session_id: "session-accumulate",
        cost: {
          total_cost_usd: 0.5,
          total_lines_added: 10,
          total_lines_removed: 5,
        },
        context_window: {
          total_input_tokens: 500,
          total_output_tokens: 200,
          current_usage: {
            input_tokens: 500,
            cache_read_input_tokens: 20000,
            cache_creation_input_tokens: 5000,
            output_tokens: 200,
          },
        },
        transcript_path: "",
      });

      execSync(statusLineCommand, {
        input: firstCallInput,
        encoding: "utf-8",
      });

      // Second API call (same session, raw totals grew)
      const secondCallInput = JSON.stringify({
        cwd: tempDir,
        session_id: "session-accumulate",
        cost: {
          total_cost_usd: 1.75,
          total_lines_added: 30,
          total_lines_removed: 10,
        },
        context_window: {
          total_input_tokens: 1000,
          total_output_tokens: 600,
          current_usage: {
            input_tokens: 500,
            cache_read_input_tokens: 20000,
            cache_creation_input_tokens: 0,
            output_tokens: 400,
          },
        },
        transcript_path: "",
      });

      const output = execSync(statusLineCommand, {
        input: secondCallInput,
        encoding: "utf-8",
      });

      // First call: 500 + 20000 + 5000 + 200 = 25700
      // Second call: 500 + 20000 + 0 + 400 = 20900
      // Total: 46600 = 46.6k
      expect(output).toContain("Tokens: 46.6k");
      // Cost should show raw cumulative $1.75
      expect(output).toContain("Cost: $1.75");
      expect(output).toContain("Lines: +30/-10");
    });

    it("should not double-count tokens when invoked repeatedly with same data", async () => {
      const config: Config = { installDir: claudeDir };

      await statuslineLoader.run({ agent: {} as any, config });

      const content = await fs.readFile(settingsPath, "utf-8");
      const settings = JSON.parse(content);
      const statusLineCommand = settings.statusLine.command;

      const { execSync } = await import("child_process");

      const sameInput = JSON.stringify({
        cwd: tempDir,
        session_id: "session-no-double",
        cost: {
          total_cost_usd: 0.5,
          total_lines_added: 10,
          total_lines_removed: 5,
        },
        context_window: {
          total_input_tokens: 500,
          total_output_tokens: 200,
          current_usage: {
            input_tokens: 500,
            cache_read_input_tokens: 20000,
            cache_creation_input_tokens: 5000,
            output_tokens: 200,
          },
        },
        transcript_path: "",
      });

      // First invocation
      execSync(statusLineCommand, {
        input: sameInput,
        encoding: "utf-8",
      });

      // Second invocation with identical data (timer-driven refresh, no new API call)
      const output = execSync(statusLineCommand, {
        input: sameInput,
        encoding: "utf-8",
      });

      // Should still show 25.7k (not 51.4k from double-counting)
      expect(output).toContain("Tokens: 25.7k");
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
