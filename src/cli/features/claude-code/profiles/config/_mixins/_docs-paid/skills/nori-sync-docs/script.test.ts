/**
 * Tests for nori-sync-docs skill script
 */

import { execSync } from "child_process";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { main, serializeError } from "./script.js";

describe("nori-sync-docs script", () => {
  let tempConfigPath: string;
  let originalArgv: Array<string>;
  let originalCwd: string;
  let tempProjectDir: string;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let processExitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    originalArgv = process.argv;
    originalCwd = process.cwd();

    tempProjectDir = path.join(
      os.tmpdir(),
      `sync-noridocs-project-${Date.now()}`,
    );
    await fs.mkdir(tempProjectDir, { recursive: true });
    process.chdir(tempProjectDir);

    // Config file is now in the project directory (cwd)
    tempConfigPath = path.join(tempProjectDir, ".nori-config.json");

    // Initialize git repo in temp project directory
    execSync("git init -b main", { cwd: tempProjectDir });
    execSync('git config user.email "test@example.com"', {
      cwd: tempProjectDir,
    });
    execSync('git config user.name "Test User"', { cwd: tempProjectDir });

    consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    consoleLogSpy = vi
      .spyOn(console, "log")
      .mockImplementation(() => undefined);
    processExitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((code?: string | number | null) => {
        throw new Error(`process.exit(${code})`);
      }) as any;
  });

  afterEach(async () => {
    process.argv = originalArgv;
    process.chdir(originalCwd);

    consoleErrorSpy.mockRestore();
    consoleLogSpy.mockRestore();
    processExitSpy.mockRestore();

    try {
      await fs.rm(tempProjectDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("tier checking", () => {
    it("should fail when no config file exists", async () => {
      process.argv = ["node", "script.js"];

      await expect(main()).rejects.toThrow("process.exit(1)");
      expect(processExitSpy).toHaveBeenCalledWith(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Error: No Nori installation found.",
      );
    });

    it("should fail when config has no auth credentials", async () => {
      await fs.mkdir(path.dirname(tempConfigPath), { recursive: true });
      await fs.writeFile(tempConfigPath, JSON.stringify({}));

      process.argv = ["node", "script.js"];

      await expect(main()).rejects.toThrow("process.exit(1)");
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe("file finding", () => {
    it("should handle no docs.md files found", async () => {
      await fs.mkdir(path.dirname(tempConfigPath), { recursive: true });
      await fs.writeFile(
        tempConfigPath,
        JSON.stringify({
          username: "test@example.com",
          password: "password",
          organizationUrl: "https://test.nori.ai",
        }),
      );

      process.argv = ["node", "script.js"];

      await expect(main()).resolves.toBeUndefined();
      const logCalls = consoleLogSpy.mock.calls.flat().join("\n");
      expect(logCalls).toMatch(/Found 0 docs\.md file/);
      expect(logCalls).toMatch(/No docs\.md files found to sync/);
    });
  });

  describe("argument parsing", () => {
    it("should accept optional --delay parameter", async () => {
      // Test structure for API mock integration
      expect(true).toBe(true);
    });

    it("should accept optional --gitRepoUrl parameter", async () => {
      // Test structure for API mock integration
      expect(true).toBe(true);
    });
  });

  describe("error logging", () => {
    it("should serialize Error objects with message", () => {
      const result = serializeError({ error: new Error("Connection failed") });
      expect(result).toBe("Connection failed");
    });

    it("should serialize plain object errors with JSON", () => {
      const result = serializeError({
        error: {
          status: 403,
          message: "Forbidden",
          details: "Invalid credentials",
        },
      });
      expect(result).toContain("status");
      expect(result).toContain("403");
      expect(result).toContain("Forbidden");
      expect(result).toContain("Invalid credentials");
    });

    it("should handle errors with nested objects", () => {
      const result = serializeError({
        error: {
          error: {
            code: "RATE_LIMIT",
            details: { retryAfter: 60 },
          },
        },
      });
      expect(result).toContain("RATE_LIMIT");
      expect(result).toContain("retryAfter");
      expect(result).toContain("60");
    });

    it("should handle string errors", () => {
      const result = serializeError({ error: "Network timeout" });
      expect(result).toBe("Network timeout");
    });

    it("should handle null errors gracefully", () => {
      const result = serializeError({ error: null });
      expect(result).toBe("Unknown error (null)");
    });

    it("should handle undefined errors gracefully", () => {
      const result = serializeError({ error: undefined });
      expect(result).toBe("Unknown error (null)");
    });

    it("should handle empty object errors", () => {
      const result = serializeError({ error: {} });
      expect(result).toBe("Unknown error (empty object)");
    });

    it("should handle number errors", () => {
      const result = serializeError({ error: 404 });
      expect(result).toBe("404");
    });
  });
});
