/**
 * Tests for Cursor hooks feature loader
 * Verifies install, uninstall, and validate operations
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import type { Config } from "@/cli/config.js";

// Mock the env module to use temp directories
let mockCursorDir: string;
let mockCursorHooksFile: string;

vi.mock("@/cli/env.js", () => ({
  getCursorDir: () => mockCursorDir,
  getCursorHooksFile: () => mockCursorHooksFile,
  getCursorHomeDir: () => mockCursorDir,
  getCursorHomeHooksFile: () => mockCursorHooksFile,
  getCursorSettingsFile: () => path.join(mockCursorDir, "settings.json"),
  getCursorProfilesDir: () => path.join(mockCursorDir, "profiles"),
}));

// Import loader after mocking env
import { cursorHooksLoader } from "./loader.js";

describe("cursorHooksLoader", () => {
  let tempDir: string;
  let cursorDir: string;
  let hooksPath: string;

  beforeEach(async () => {
    // Create temp directory for testing
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "cursor-hooks-test-"));
    cursorDir = path.join(tempDir, ".cursor");
    hooksPath = path.join(cursorDir, "hooks.json");

    // Set mock paths
    mockCursorDir = cursorDir;
    mockCursorHooksFile = hooksPath;

    // Create directories
    await fs.mkdir(cursorDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up temp directory
    await fs.rm(tempDir, { recursive: true, force: true });

    // Clear all mocks
    vi.clearAllMocks();
  });

  describe("run", () => {
    it("should create hooks.json with correct Cursor format", async () => {
      const config: Config = { installDir: tempDir };

      await cursorHooksLoader.run({ config });

      // Verify hooks.json exists
      const exists = await fs
        .access(hooksPath)
        .then(() => true)
        .catch(() => false);

      expect(exists).toBe(true);

      // Read and parse hooks.json
      const content = await fs.readFile(hooksPath, "utf-8");
      const hooks = JSON.parse(content);

      // Verify Cursor hooks format
      expect(hooks.version).toBe(1);
      expect(hooks.hooks).toBeDefined();
    });

    it("should configure beforeSubmitPrompt hook for slash command interception", async () => {
      const config: Config = { installDir: tempDir };

      await cursorHooksLoader.run({ config });

      const content = await fs.readFile(hooksPath, "utf-8");
      const hooks = JSON.parse(content);

      // Verify beforeSubmitPrompt hook is configured
      expect(hooks.hooks.beforeSubmitPrompt).toBeDefined();
      expect(hooks.hooks.beforeSubmitPrompt.length).toBeGreaterThan(0);

      // Find cursor-before-submit-prompt command
      const hasSlashCommandHook = hooks.hooks.beforeSubmitPrompt.some(
        (hook: { command: string }) =>
          hook.command.includes("cursor-before-submit-prompt"),
      );
      expect(hasSlashCommandHook).toBe(true);
    });

    it("should preserve existing hooks when adding new ones", async () => {
      const config: Config = { installDir: tempDir };

      // Create hooks.json with existing content
      const existingHooks = {
        version: 1,
        hooks: {
          afterFileEdit: [{ command: "npx prettier --write" }],
        },
      };
      await fs.writeFile(hooksPath, JSON.stringify(existingHooks, null, 2));

      await cursorHooksLoader.run({ config });

      // Read and parse hooks.json
      const content = await fs.readFile(hooksPath, "utf-8");
      const hooks = JSON.parse(content);

      // Verify existing hooks are preserved
      expect(hooks.hooks.afterFileEdit).toBeDefined();
      expect(hooks.hooks.afterFileEdit[0].command).toBe("npx prettier --write");

      // Verify new hooks are added
      expect(hooks.hooks.beforeSubmitPrompt).toBeDefined();
    });

    it("should update hooks if already configured", async () => {
      const config: Config = { installDir: tempDir };

      // First installation
      await cursorHooksLoader.run({ config });

      // Second installation (update)
      await cursorHooksLoader.run({ config });

      // Read updated hooks
      const content = await fs.readFile(hooksPath, "utf-8");
      const hooks = JSON.parse(content);

      // Verify hooks still exist and are not duplicated
      expect(hooks.version).toBe(1);
      expect(hooks.hooks.beforeSubmitPrompt).toBeDefined();

      // Each Nori hook should only appear once
      const noriHooks = hooks.hooks.beforeSubmitPrompt.filter(
        (hook: { command: string }) =>
          hook.command.includes("cursor-before-submit-prompt"),
      );
      expect(noriHooks.length).toBe(1);
    });

    it("should create .cursor directory if it does not exist", async () => {
      const config: Config = { installDir: tempDir };

      // Remove the .cursor directory
      await fs.rm(cursorDir, { recursive: true, force: true });

      await cursorHooksLoader.run({ config });

      // Verify directory was created
      const dirExists = await fs
        .access(cursorDir)
        .then(() => true)
        .catch(() => false);
      expect(dirExists).toBe(true);

      // Verify hooks.json was created
      const fileExists = await fs
        .access(hooksPath)
        .then(() => true)
        .catch(() => false);
      expect(fileExists).toBe(true);
    });

    it("should not configure paid-only hooks", async () => {
      // Even with auth, we skip paid features for Cursor per requirements
      const config: Config = {
        installDir: tempDir,
        auth: {
          username: "test@example.com",
          password: "testpass",
          organizationUrl: "https://example.com",
        },
      };

      await cursorHooksLoader.run({ config });

      const content = await fs.readFile(hooksPath, "utf-8");
      const hooks = JSON.parse(content);

      // Verify no stop hook (which would contain summarize)
      // We skip all paid features for Cursor
      expect(hooks.hooks.stop).toBeUndefined();
    });
  });

  describe("uninstall", () => {
    it("should remove Nori hooks from hooks.json", async () => {
      const config: Config = { installDir: tempDir };

      // Install first
      await cursorHooksLoader.run({ config });

      // Verify hooks exist
      let content = await fs.readFile(hooksPath, "utf-8");
      let hooks = JSON.parse(content);
      expect(hooks.hooks.beforeSubmitPrompt).toBeDefined();

      // Uninstall
      await cursorHooksLoader.uninstall({ config });

      // Verify Nori hooks are removed
      content = await fs.readFile(hooksPath, "utf-8");
      hooks = JSON.parse(content);

      // beforeSubmitPrompt should either be undefined or have no Nori hooks
      if (hooks.hooks.beforeSubmitPrompt) {
        const noriHooks = hooks.hooks.beforeSubmitPrompt.filter(
          (hook: { command: string }) =>
            hook.command.includes("cursor-before-submit-prompt"),
        );
        expect(noriHooks.length).toBe(0);
      }
    });

    it("should preserve user hooks when removing Nori hooks", async () => {
      const config: Config = { installDir: tempDir };

      // Create hooks.json with both user and Nori hooks
      const initialHooks = {
        version: 1,
        hooks: {
          afterFileEdit: [{ command: "npx prettier --write" }],
          beforeSubmitPrompt: [
            { command: "./my-custom-hook.sh" },
            { command: "node /path/to/cursor-before-submit-prompt.js" },
          ],
        },
      };
      await fs.writeFile(hooksPath, JSON.stringify(initialHooks, null, 2));

      // Uninstall
      await cursorHooksLoader.uninstall({ config });

      // Verify user hooks are preserved
      const content = await fs.readFile(hooksPath, "utf-8");
      const hooks = JSON.parse(content);

      expect(hooks.hooks.afterFileEdit).toBeDefined();
      expect(hooks.hooks.afterFileEdit[0].command).toBe("npx prettier --write");

      // User's custom hook should be preserved
      expect(hooks.hooks.beforeSubmitPrompt).toBeDefined();
      expect(
        hooks.hooks.beforeSubmitPrompt.some(
          (hook: { command: string }) => hook.command === "./my-custom-hook.sh",
        ),
      ).toBe(true);

      // Nori hook should be removed
      expect(
        hooks.hooks.beforeSubmitPrompt.some((hook: { command: string }) =>
          hook.command.includes("cursor-before-submit-prompt"),
        ),
      ).toBe(false);
    });

    it("should handle missing hooks.json gracefully", async () => {
      const config: Config = { installDir: tempDir };

      // Uninstall without installing first
      await expect(
        cursorHooksLoader.uninstall({ config }),
      ).resolves.not.toThrow();
    });

    it("should handle hooks.json without beforeSubmitPrompt gracefully", async () => {
      const config: Config = { installDir: tempDir };

      // Create hooks.json without beforeSubmitPrompt
      const hooks = {
        version: 1,
        hooks: {
          afterFileEdit: [{ command: "npx prettier --write" }],
        },
      };
      await fs.writeFile(hooksPath, JSON.stringify(hooks, null, 2));

      // Uninstall
      await expect(
        cursorHooksLoader.uninstall({ config }),
      ).resolves.not.toThrow();

      // Verify hooks.json still exists and is unchanged
      const content = await fs.readFile(hooksPath, "utf-8");
      const updatedHooks = JSON.parse(content);
      expect(updatedHooks.hooks.afterFileEdit[0].command).toBe(
        "npx prettier --write",
      );
    });

    it("should remove hooks.json if only Nori hooks existed", async () => {
      const config: Config = { installDir: tempDir };

      // Install Nori hooks only
      await cursorHooksLoader.run({ config });

      // Uninstall
      await cursorHooksLoader.uninstall({ config });

      // Read hooks.json
      const content = await fs.readFile(hooksPath, "utf-8");
      const hooks = JSON.parse(content);

      // Should have empty hooks object or no beforeSubmitPrompt
      const hasBeforeSubmitPrompt = hooks.hooks.beforeSubmitPrompt != null;
      const hasNoriHooks =
        hasBeforeSubmitPrompt &&
        hooks.hooks.beforeSubmitPrompt.some((hook: { command: string }) =>
          hook.command.includes("cursor-before-submit-prompt"),
        );
      expect(hasNoriHooks).toBe(false);
    });
  });

  describe("validate", () => {
    it("should return valid for properly installed hooks", async () => {
      const config: Config = { installDir: tempDir };

      // Install
      await cursorHooksLoader.run({ config });

      // Validate
      if (cursorHooksLoader.validate == null) {
        throw new Error("validate method not implemented");
      }

      const result = await cursorHooksLoader.validate({ config });

      expect(result.valid).toBe(true);
      expect(result.message).toContain("properly configured");
      expect(result.errors).toBeNull();
    });

    it("should return invalid when hooks.json does not exist", async () => {
      const config: Config = { installDir: tempDir };

      // Validate without installing
      if (cursorHooksLoader.validate == null) {
        throw new Error("validate method not implemented");
      }

      const result = await cursorHooksLoader.validate({ config });

      expect(result.valid).toBe(false);
      expect(result.errors).not.toBeNull();
      expect(result.errors?.length).toBeGreaterThan(0);
    });

    it("should return invalid when beforeSubmitPrompt hook is missing", async () => {
      const config: Config = { installDir: tempDir };

      // Create hooks.json without beforeSubmitPrompt
      const hooks = {
        version: 1,
        hooks: {
          afterFileEdit: [{ command: "npx prettier --write" }],
        },
      };
      await fs.writeFile(hooksPath, JSON.stringify(hooks, null, 2));

      // Validate
      if (cursorHooksLoader.validate == null) {
        throw new Error("validate method not implemented");
      }

      const result = await cursorHooksLoader.validate({ config });

      expect(result.valid).toBe(false);
      expect(result.errors).not.toBeNull();
      expect(result.errors?.length).toBeGreaterThan(0);
      expect(result.errors?.[0]).toContain("beforeSubmitPrompt");
    });

    it("should return invalid when Nori hook command is missing from beforeSubmitPrompt", async () => {
      const config: Config = { installDir: tempDir };

      // Create hooks.json with beforeSubmitPrompt but no Nori hook
      const hooks = {
        version: 1,
        hooks: {
          beforeSubmitPrompt: [{ command: "./my-custom-hook.sh" }],
        },
      };
      await fs.writeFile(hooksPath, JSON.stringify(hooks, null, 2));

      // Validate
      if (cursorHooksLoader.validate == null) {
        throw new Error("validate method not implemented");
      }

      const result = await cursorHooksLoader.validate({ config });

      expect(result.valid).toBe(false);
      expect(result.errors).not.toBeNull();
      expect(result.errors?.length).toBeGreaterThan(0);
      expect(result.errors?.[0]).toContain("cursor-before-submit-prompt");
    });

    it("should handle invalid JSON in hooks.json", async () => {
      const config: Config = { installDir: tempDir };

      // Create hooks.json with invalid JSON
      await fs.writeFile(hooksPath, "not valid json");

      // Validate
      if (cursorHooksLoader.validate == null) {
        throw new Error("validate method not implemented");
      }

      const result = await cursorHooksLoader.validate({ config });

      expect(result.valid).toBe(false);
      expect(result.message).toContain("Invalid");
      expect(result.errors).not.toBeNull();
    });
  });
});
