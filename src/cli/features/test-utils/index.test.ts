/**
 * Tests for shared test utilities
 */

import * as fs from "fs/promises";
import * as path from "path";

import { describe, it, expect, afterEach } from "vitest";

import {
  stripAnsi,
  pathExists,
  createTempTestContext,
  type TempTestContext,
} from "./index.js";

describe("stripAnsi", () => {
  it("should remove ANSI color codes from string", () => {
    const input = "\x1b[32mSuccess\x1b[0m: Operation completed";
    const result = stripAnsi(input);
    expect(result).toBe("Success: Operation completed");
  });

  it("should handle strings without ANSI codes", () => {
    const input = "Plain text without colors";
    const result = stripAnsi(input);
    expect(result).toBe("Plain text without colors");
  });

  it("should handle multiple ANSI codes", () => {
    const input =
      "\x1b[31mError:\x1b[0m \x1b[33mWarning\x1b[0m \x1b[32mOK\x1b[0m";
    const result = stripAnsi(input);
    expect(result).toBe("Error: Warning OK");
  });

  it("should handle empty strings", () => {
    const result = stripAnsi("");
    expect(result).toBe("");
  });
});

describe("pathExists", () => {
  let tempDir: string;

  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("should return true for existing file", async () => {
    const ctx = await createTempTestContext({ prefix: "pathExists-test" });
    tempDir = ctx.tempDir;

    const testFile = path.join(ctx.tempDir, "test.txt");
    await fs.writeFile(testFile, "test content");

    const exists = await pathExists({ filePath: testFile });
    expect(exists).toBe(true);

    await ctx.cleanup();
  });

  it("should return false for non-existing file", async () => {
    const exists = await pathExists({ filePath: "/nonexistent/path/file.txt" });
    expect(exists).toBe(false);
  });

  it("should return true for existing directory", async () => {
    const ctx = await createTempTestContext({ prefix: "pathExists-test" });
    tempDir = ctx.tempDir;

    const exists = await pathExists({ filePath: ctx.claudeDir });
    expect(exists).toBe(true);

    await ctx.cleanup();
  });
});

describe("createTempTestContext", () => {
  let ctx: TempTestContext | null = null;

  afterEach(async () => {
    if (ctx) {
      await ctx.cleanup();
      ctx = null;
    }
  });

  it("should create temp directory with prefix", async () => {
    ctx = await createTempTestContext({ prefix: "my-test" });

    expect(ctx.tempDir).toContain("my-test");
    const exists = await pathExists({ filePath: ctx.tempDir });
    expect(exists).toBe(true);
  });

  it("should create .claude subdirectory", async () => {
    ctx = await createTempTestContext({ prefix: "claude-test" });

    expect(ctx.claudeDir).toBe(path.join(ctx.tempDir, ".claude"));
    const exists = await pathExists({ filePath: ctx.claudeDir });
    expect(exists).toBe(true);
  });

  it("should cleanup temp directory when cleanup is called", async () => {
    ctx = await createTempTestContext({ prefix: "cleanup-test" });
    const tempDir = ctx.tempDir;

    await ctx.cleanup();
    ctx = null;

    const exists = await pathExists({ filePath: tempDir });
    expect(exists).toBe(false);
  });
});
