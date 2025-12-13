/**
 * Tests for check command auto-detection of installation directory
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { checkMain } from "./check.js";

describe("check command", () => {
  let tempDir: string;
  let originalCwd: () => string;
  let processExitSpy: ReturnType<typeof vi.spyOn>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    // Create temp directory for testing
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "check-test-"));

    // Mock process.cwd()
    originalCwd = process.cwd;

    // Mock process.exit to throw so we can catch it
    processExitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((code?: string | number | null) => {
        throw new Error(`process.exit(${code})`);
      }) as any;

    // Mock console to capture output
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {
      // Suppress console.log output in tests
    });
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {
      // Suppress console.error output in tests
    });
  });

  afterEach(async () => {
    // Restore mocks
    process.cwd = originalCwd;
    processExitSpy.mockRestore();
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();

    // Clean up temp directory
    await fs.rm(tempDir, { recursive: true, force: true });

    vi.clearAllMocks();
  });

  describe("auto-detection", () => {
    it("should auto-detect installation from current directory", async () => {
      // Create a Nori installation marker
      await fs.writeFile(
        path.join(tempDir, ".nori-config.json"),
        JSON.stringify({ profile: { baseProfile: "senior-swe" } }),
      );

      // Mock cwd to return the temp directory with installation
      process.cwd = () => tempDir;

      // Run check without explicit installDir
      // It should find the installation and run validation
      // (will exit with error since no loaders are installed, but that's fine)
      try {
        await checkMain({});
      } catch (e: any) {
        // Expected to exit (either success or failure)
      }

      // Verify it ran validation (look for "Running Nori Profiles validation checks...")
      const logCalls = consoleLogSpy.mock.calls.flat().join("\n");
      expect(logCalls).toContain("Running Nori Profiles validation checks");
    });

    it("should auto-detect installation from child directory", async () => {
      // Create a Nori installation marker in parent
      await fs.writeFile(
        path.join(tempDir, ".nori-config.json"),
        JSON.stringify({ profile: { baseProfile: "senior-swe" } }),
      );

      // Create a child directory
      const childDir = path.join(tempDir, "subproject", "src");
      await fs.mkdir(childDir, { recursive: true });

      // Mock cwd to return the child directory
      process.cwd = () => childDir;

      // Run check without explicit installDir
      try {
        await checkMain({});
      } catch (e: any) {
        // Expected to exit
      }

      // Verify it ran validation (found parent installation)
      const logCalls = consoleLogSpy.mock.calls.flat().join("\n");
      expect(logCalls).toContain("Running Nori Profiles validation checks");
    });

    it("should show error when no installation found", async () => {
      // Create an empty directory (no Nori installation)
      const emptyDir = path.join(tempDir, "empty-project");
      await fs.mkdir(emptyDir, { recursive: true });

      // Mock cwd to return the empty directory
      process.cwd = () => emptyDir;

      // Run check without explicit installDir - should fail
      await expect(checkMain({})).rejects.toThrow("process.exit(1)");

      // Verify error message
      const errorCalls = consoleErrorSpy.mock.calls.flat().join("\n");
      expect(errorCalls).toContain("No Nori installations found");
    });

    it("should use explicit --install-dir when provided", async () => {
      // Create installation in a specific directory
      const explicitDir = path.join(tempDir, "explicit-install");
      await fs.mkdir(explicitDir, { recursive: true });
      await fs.writeFile(
        path.join(explicitDir, ".nori-config.json"),
        JSON.stringify({ profile: { baseProfile: "senior-swe" } }),
      );

      // Mock cwd to return a different directory (without installation)
      const otherDir = path.join(tempDir, "other");
      await fs.mkdir(otherDir, { recursive: true });
      process.cwd = () => otherDir;

      // Run check with explicit installDir
      try {
        await checkMain({ installDir: explicitDir });
      } catch (e: any) {
        // Expected to exit
      }

      // Verify it ran validation (used explicit directory)
      const logCalls = consoleLogSpy.mock.calls.flat().join("\n");
      expect(logCalls).toContain("Running Nori Profiles validation checks");
    });

    it("should error when config file is corrupted (invalid JSON)", async () => {
      // Create a config file with invalid JSON (corrupted)
      // This makes hasExistingInstallation return true (file exists)
      // but loadConfig returns null (invalid JSON)
      await fs.writeFile(
        path.join(tempDir, ".nori-config.json"),
        "{ invalid json syntax",
      );

      // Mock cwd to return the temp directory
      process.cwd = () => tempDir;

      // Run check - should fail because config is corrupted
      await expect(checkMain({})).rejects.toThrow("process.exit(1)");

      // Verify error message mentions config issue AND we exit early
      // (should NOT run loader validations with fake config)
      const errorCalls = consoleErrorSpy.mock.calls.flat().join("\n");
      expect(errorCalls).toContain("missing or corrupted");

      // Should NOT contain loader validation errors (we should exit before that)
      expect(errorCalls).not.toContain("Profiles directory not found");
    });
  });
});
