/**
 * Tests for cursor-agent hooks feature loader
 * Verifies install, uninstall, and validate operations for Cursor IDE hooks
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import type { Config } from "@/cli/config.js";

// Mock the paths module to use temp directories
let mockCursorDir: string;
let mockCursorHooksFile: string;

vi.mock("@/cli/features/cursor-agent/paths.js", () => ({
  getCursorDir: (_args: { installDir: string }) => mockCursorDir,
  getCursorHooksFile: (_args: { installDir: string }) => mockCursorHooksFile,
  getCursorProfilesDir: (_args: { installDir: string }) =>
    path.join(mockCursorDir, "profiles"),
  getCursorRulesDir: (_args: { installDir: string }) =>
    path.join(mockCursorDir, "rules"),
  getCursorAgentsMdFile: (args: { installDir: string }) =>
    path.join(args.installDir, "AGENTS.md"),
}));

// Import loader after mocking paths
import { hooksLoader } from "./loader.js";

describe("cursor-agent hooksLoader", () => {
  let tempDir: string;
  let cursorDir: string;
  let hooksFilePath: string;

  beforeEach(async () => {
    // Create temp directory for testing
    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "cursor-agent-hooks-test-"),
    );
    cursorDir = path.join(tempDir, ".cursor");
    hooksFilePath = path.join(cursorDir, "hooks.json");

    // Set mock paths
    mockCursorDir = cursorDir;
    mockCursorHooksFile = hooksFilePath;

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
    it("should create hooks.json with stop event for notification", async () => {
      const config: Config = { installDir: tempDir };

      await hooksLoader.run({ config });

      // Verify hooks.json exists
      const exists = await fs
        .access(hooksFilePath)
        .then(() => true)
        .catch(() => false);

      expect(exists).toBe(true);

      // Read and parse hooks.json
      const content = await fs.readFile(hooksFilePath, "utf-8");
      const hooksConfig = JSON.parse(content);

      // Verify Cursor hooks.json schema
      expect(hooksConfig.version).toBe(1);
      expect(hooksConfig.hooks).toBeDefined();
      expect(hooksConfig.hooks.stop).toBeDefined();
      expect(Array.isArray(hooksConfig.hooks.stop)).toBe(true);
      expect(hooksConfig.hooks.stop.length).toBeGreaterThan(0);
    });

    it("should configure stop hook with notify-hook.sh command", async () => {
      const config: Config = { installDir: tempDir };

      await hooksLoader.run({ config });

      const content = await fs.readFile(hooksFilePath, "utf-8");
      const hooksConfig = JSON.parse(content);

      // Find notify hook in stop hooks
      const stopHooks = hooksConfig.hooks.stop;
      const hasNotifyHook = stopHooks.some((hook: { command: string }) =>
        hook.command.includes("notify-hook.sh"),
      );

      expect(hasNotifyHook).toBe(true);
    });

    it("should pass NORI_INSTALL_DIR environment variable in hook command", async () => {
      const config: Config = { installDir: tempDir };

      await hooksLoader.run({ config });

      const content = await fs.readFile(hooksFilePath, "utf-8");
      const hooksConfig = JSON.parse(content);

      // Find notify hook in stop hooks
      const notifyHook = hooksConfig.hooks.stop.find(
        (hook: { command: string }) => hook.command.includes("notify-hook.sh"),
      );

      // Verify NORI_INSTALL_DIR is passed with correct value
      expect(notifyHook.command).toContain(`NORI_INSTALL_DIR="${tempDir}"`);
    });

    it("should preserve existing hooks when adding notification hook", async () => {
      const config: Config = { installDir: tempDir };

      // Create hooks.json with existing custom hook
      const existingHooks = {
        version: 1,
        hooks: {
          beforeShellExecution: [{ command: "./custom-audit.sh" }],
        },
      };
      await fs.writeFile(hooksFilePath, JSON.stringify(existingHooks, null, 2));

      await hooksLoader.run({ config });

      // Read updated hooks.json
      const content = await fs.readFile(hooksFilePath, "utf-8");
      const hooksConfig = JSON.parse(content);

      // Verify existing hook is preserved
      expect(hooksConfig.hooks.beforeShellExecution).toBeDefined();
      expect(hooksConfig.hooks.beforeShellExecution[0].command).toBe(
        "./custom-audit.sh",
      );

      // Verify new hook is added
      expect(hooksConfig.hooks.stop).toBeDefined();
    });

    it("should preserve user's existing stop hooks when adding notification", async () => {
      const config: Config = { installDir: tempDir };

      // Create hooks.json with existing stop hook
      const existingHooks = {
        version: 1,
        hooks: {
          stop: [{ command: "./user-custom-stop-hook.sh" }],
        },
      };
      await fs.writeFile(hooksFilePath, JSON.stringify(existingHooks, null, 2));

      await hooksLoader.run({ config });

      // Read updated hooks.json
      const content = await fs.readFile(hooksFilePath, "utf-8");
      const hooksConfig = JSON.parse(content);

      // Verify both hooks exist
      expect(hooksConfig.hooks.stop.length).toBeGreaterThanOrEqual(2);

      // Verify user's hook is preserved
      const hasUserHook = hooksConfig.hooks.stop.some(
        (hook: { command: string }) =>
          hook.command === "./user-custom-stop-hook.sh",
      );
      expect(hasUserHook).toBe(true);

      // Verify notify hook is added
      const hasNotifyHook = hooksConfig.hooks.stop.some(
        (hook: { command: string }) => hook.command.includes("notify-hook.sh"),
      );
      expect(hasNotifyHook).toBe(true);
    });

    it("should create .cursor directory if it does not exist", async () => {
      const config: Config = { installDir: tempDir };

      // Remove the .cursor directory
      await fs.rm(cursorDir, { recursive: true, force: true });

      await hooksLoader.run({ config });

      // Verify .cursor directory was created
      const exists = await fs
        .access(cursorDir)
        .then(() => true)
        .catch(() => false);

      expect(exists).toBe(true);
    });

    it("should not duplicate notify hook on repeated installs", async () => {
      const config: Config = { installDir: tempDir };

      // Run install twice
      await hooksLoader.run({ config });
      await hooksLoader.run({ config });

      const content = await fs.readFile(hooksFilePath, "utf-8");
      const hooksConfig = JSON.parse(content);

      // Count notify hooks
      const notifyHookCount = hooksConfig.hooks.stop.filter(
        (hook: { command: string }) => hook.command.includes("notify-hook.sh"),
      ).length;

      expect(notifyHookCount).toBe(1);
    });
  });

  describe("uninstall", () => {
    it("should remove nori hooks from hooks.json", async () => {
      const config: Config = { installDir: tempDir };

      // Install first
      await hooksLoader.run({ config });

      // Verify hooks exist
      let content = await fs.readFile(hooksFilePath, "utf-8");
      let hooksConfig = JSON.parse(content);
      expect(hooksConfig.hooks.stop).toBeDefined();

      // Uninstall
      await hooksLoader.uninstall({ config });

      // Verify hooks.json still exists but stop hook is removed
      content = await fs.readFile(hooksFilePath, "utf-8");
      hooksConfig = JSON.parse(content);

      // If there are no other hooks, the stop array should be empty or undefined
      const hasNotifyHook =
        hooksConfig.hooks.stop?.some((hook: { command: string }) =>
          hook.command.includes("notify-hook.sh"),
        ) ?? false;
      expect(hasNotifyHook).toBe(false);
    });

    it("should preserve user hooks when uninstalling nori hooks", async () => {
      const config: Config = { installDir: tempDir };

      // Create hooks.json with both user hook and nori hook
      const mixedHooks = {
        version: 1,
        hooks: {
          stop: [
            { command: "./user-custom-hook.sh" },
            { command: "/path/to/notify-hook.sh" },
          ],
          beforeShellExecution: [{ command: "./audit.sh" }],
        },
      };
      await fs.writeFile(hooksFilePath, JSON.stringify(mixedHooks, null, 2));

      // Uninstall
      await hooksLoader.uninstall({ config });

      const content = await fs.readFile(hooksFilePath, "utf-8");
      const hooksConfig = JSON.parse(content);

      // Verify user hooks are preserved
      expect(hooksConfig.hooks.beforeShellExecution).toBeDefined();
      expect(hooksConfig.hooks.beforeShellExecution[0].command).toBe(
        "./audit.sh",
      );

      // Verify user's stop hook is preserved
      const hasUserHook = hooksConfig.hooks.stop?.some(
        (hook: { command: string }) => hook.command === "./user-custom-hook.sh",
      );
      expect(hasUserHook).toBe(true);

      // Verify nori hook is removed
      const hasNotifyHook =
        hooksConfig.hooks.stop?.some((hook: { command: string }) =>
          hook.command.includes("notify-hook.sh"),
        ) ?? false;
      expect(hasNotifyHook).toBe(false);
    });

    it("should handle missing hooks.json gracefully", async () => {
      const config: Config = { installDir: tempDir };

      // Uninstall without installing first (no hooks.json exists)
      await expect(hooksLoader.uninstall({ config })).resolves.not.toThrow();
    });

    it("should handle hooks.json without stop event gracefully", async () => {
      const config: Config = { installDir: tempDir };

      // Create hooks.json without stop event
      const hooksConfig = {
        version: 1,
        hooks: {
          beforeShellExecution: [{ command: "./audit.sh" }],
        },
      };
      await fs.writeFile(hooksFilePath, JSON.stringify(hooksConfig, null, 2));

      // Uninstall
      await expect(hooksLoader.uninstall({ config })).resolves.not.toThrow();

      // Verify file still exists and is unchanged
      const content = await fs.readFile(hooksFilePath, "utf-8");
      const updatedConfig = JSON.parse(content);
      expect(updatedConfig.hooks.beforeShellExecution).toBeDefined();
    });
  });

  describe("validate", () => {
    it("should return valid when hooks are properly configured", async () => {
      const config: Config = { installDir: tempDir };

      // Install hooks
      await hooksLoader.run({ config });

      // Validate
      if (hooksLoader.validate == null) {
        throw new Error("validate method not implemented");
      }

      const result = await hooksLoader.validate({ config });

      expect(result.valid).toBe(true);
      expect(result.message).toContain("properly configured");
      expect(result.errors).toBeNull();
    });

    it("should return invalid when hooks.json does not exist", async () => {
      const config: Config = { installDir: tempDir };

      // Validate without installing
      if (hooksLoader.validate == null) {
        throw new Error("validate method not implemented");
      }

      const result = await hooksLoader.validate({ config });

      expect(result.valid).toBe(false);
      expect(result.message).toContain("not found");
      expect(result.errors).not.toBeNull();
      expect(result.errors?.length).toBeGreaterThan(0);
    });

    it("should return invalid when stop hook is missing", async () => {
      const config: Config = { installDir: tempDir };

      // Create hooks.json without stop hook
      const hooksConfig = {
        version: 1,
        hooks: {
          beforeShellExecution: [{ command: "./audit.sh" }],
        },
      };
      await fs.writeFile(hooksFilePath, JSON.stringify(hooksConfig, null, 2));

      // Validate
      if (hooksLoader.validate == null) {
        throw new Error("validate method not implemented");
      }

      const result = await hooksLoader.validate({ config });

      expect(result.valid).toBe(false);
      expect(result.errors).not.toBeNull();
      expect(result.errors?.some((e: string) => e.includes("stop"))).toBe(true);
    });

    it("should return invalid when notify-hook is missing from stop event", async () => {
      const config: Config = { installDir: tempDir };

      // Create hooks.json with stop hook but no notify-hook
      const hooksConfig = {
        version: 1,
        hooks: {
          stop: [{ command: "./some-other-hook.sh" }],
        },
      };
      await fs.writeFile(hooksFilePath, JSON.stringify(hooksConfig, null, 2));

      // Validate
      if (hooksLoader.validate == null) {
        throw new Error("validate method not implemented");
      }

      const result = await hooksLoader.validate({ config });

      expect(result.valid).toBe(false);
      expect(result.errors).not.toBeNull();
      expect(
        result.errors?.some((e: string) => e.includes("notify-hook")),
      ).toBe(true);
    });

    it("should handle invalid JSON in hooks.json", async () => {
      const config: Config = { installDir: tempDir };

      // Create hooks.json with invalid JSON
      await fs.writeFile(hooksFilePath, "not valid json");

      // Validate
      if (hooksLoader.validate == null) {
        throw new Error("validate method not implemented");
      }

      const result = await hooksLoader.validate({ config });

      expect(result.valid).toBe(false);
      expect(result.message).toContain("Invalid");
      expect(result.errors).not.toBeNull();
    });
  });

  describe("loader interface", () => {
    it("should have correct name", () => {
      expect(hooksLoader.name).toBe("hooks");
    });

    it("should have description", () => {
      expect(hooksLoader.description).toBeDefined();
      expect(hooksLoader.description.length).toBeGreaterThan(0);
    });
  });
});
