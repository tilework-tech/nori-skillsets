/**
 * Tests for symlink-aware dirent helpers
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { isDirentDirectory, isDirentFile } from "@/utils/dirent.js";

describe("isDirentDirectory", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "dirent-test-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("should return true for a real directory", async () => {
    await fs.mkdir(path.join(tempDir, "real-dir"));
    const entries = await fs.readdir(tempDir, { withFileTypes: true });
    const entry = entries.find((e) => e.name === "real-dir")!;

    const result = await isDirentDirectory({
      parentDir: tempDir,
      entry,
    });

    expect(result).toBe(true);
  });

  it("should return true for a symlink pointing to a directory", async () => {
    const targetDir = path.join(tempDir, "target-dir");
    await fs.mkdir(targetDir);
    await fs.symlink(targetDir, path.join(tempDir, "link-to-dir"));
    const entries = await fs.readdir(tempDir, { withFileTypes: true });
    const entry = entries.find((e) => e.name === "link-to-dir")!;

    const result = await isDirentDirectory({
      parentDir: tempDir,
      entry,
    });

    expect(result).toBe(true);
  });

  it("should return false for a regular file", async () => {
    await fs.writeFile(path.join(tempDir, "file.txt"), "hello");
    const entries = await fs.readdir(tempDir, { withFileTypes: true });
    const entry = entries.find((e) => e.name === "file.txt")!;

    const result = await isDirentDirectory({
      parentDir: tempDir,
      entry,
    });

    expect(result).toBe(false);
  });

  it("should return false for a broken symlink", async () => {
    await fs.symlink(
      path.join(tempDir, "nonexistent"),
      path.join(tempDir, "broken-link"),
    );
    const entries = await fs.readdir(tempDir, { withFileTypes: true });
    const entry = entries.find((e) => e.name === "broken-link")!;

    const result = await isDirentDirectory({
      parentDir: tempDir,
      entry,
    });

    expect(result).toBe(false);
  });

  it("should return false for a symlink pointing to a file", async () => {
    await fs.writeFile(path.join(tempDir, "target-file.txt"), "hello");
    await fs.symlink(
      path.join(tempDir, "target-file.txt"),
      path.join(tempDir, "link-to-file"),
    );
    const entries = await fs.readdir(tempDir, { withFileTypes: true });
    const entry = entries.find((e) => e.name === "link-to-file")!;

    const result = await isDirentDirectory({
      parentDir: tempDir,
      entry,
    });

    expect(result).toBe(false);
  });
});

describe("isDirentFile", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "dirent-test-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("should return true for a regular file", async () => {
    await fs.writeFile(path.join(tempDir, "file.txt"), "hello");
    const entries = await fs.readdir(tempDir, { withFileTypes: true });
    const entry = entries.find((e) => e.name === "file.txt")!;

    const result = await isDirentFile({
      parentDir: tempDir,
      entry,
    });

    expect(result).toBe(true);
  });

  it("should return true for a symlink pointing to a file", async () => {
    await fs.writeFile(path.join(tempDir, "target.txt"), "hello");
    await fs.symlink(
      path.join(tempDir, "target.txt"),
      path.join(tempDir, "link-to-file"),
    );
    const entries = await fs.readdir(tempDir, { withFileTypes: true });
    const entry = entries.find((e) => e.name === "link-to-file")!;

    const result = await isDirentFile({
      parentDir: tempDir,
      entry,
    });

    expect(result).toBe(true);
  });

  it("should return false for a directory", async () => {
    await fs.mkdir(path.join(tempDir, "some-dir"));
    const entries = await fs.readdir(tempDir, { withFileTypes: true });
    const entry = entries.find((e) => e.name === "some-dir")!;

    const result = await isDirentFile({
      parentDir: tempDir,
      entry,
    });

    expect(result).toBe(false);
  });

  it("should return false for a symlink pointing to a directory", async () => {
    const targetDir = path.join(tempDir, "target-dir");
    await fs.mkdir(targetDir);
    await fs.symlink(targetDir, path.join(tempDir, "link-to-dir"));
    const entries = await fs.readdir(tempDir, { withFileTypes: true });
    const entry = entries.find((e) => e.name === "link-to-dir")!;

    const result = await isDirentFile({
      parentDir: tempDir,
      entry,
    });

    expect(result).toBe(false);
  });

  it("should return false for a broken symlink", async () => {
    await fs.symlink(
      path.join(tempDir, "nonexistent"),
      path.join(tempDir, "broken-link"),
    );
    const entries = await fs.readdir(tempDir, { withFileTypes: true });
    const entry = entries.find((e) => e.name === "broken-link")!;

    const result = await isDirentFile({
      parentDir: tempDir,
      entry,
    });

    expect(result).toBe(false);
  });
});
