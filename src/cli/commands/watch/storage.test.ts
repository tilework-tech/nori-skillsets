/**
 * Tests for watch command transcript storage
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { copyTranscript } from "@/cli/commands/watch/storage.js";

describe("copyTranscript", () => {
  let tempDir: string;
  let sourceDir: string;
  let destDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "storage-test-"));
    sourceDir = path.join(tempDir, "source");
    destDir = path.join(tempDir, "dest");
    await fs.mkdir(sourceDir);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test("copies JSONL file to destination with sessionId as filename", async () => {
    const sourceFile = path.join(sourceDir, "original.jsonl");
    const content = `{"sessionId":"abc-123","type":"user","message":"hello"}`;
    await fs.writeFile(sourceFile, content, "utf-8");

    await copyTranscript({
      sourceFile,
      destDir,
      sessionId: "abc-123",
    });

    const destFile = path.join(destDir, "abc-123.jsonl");
    const copiedContent = await fs.readFile(destFile, "utf-8");
    expect(copiedContent).toBe(content);
  });

  test("creates destination directory if it does not exist", async () => {
    const sourceFile = path.join(sourceDir, "original.jsonl");
    const content = `{"sessionId":"abc-123"}`;
    await fs.writeFile(sourceFile, content, "utf-8");

    const nestedDestDir = path.join(destDir, "nested", "path");

    await copyTranscript({
      sourceFile,
      destDir: nestedDestDir,
      sessionId: "abc-123",
    });

    const destFile = path.join(nestedDestDir, "abc-123.jsonl");
    const exists = await fs
      .stat(destFile)
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(true);
  });

  test("overwrites existing file on update", async () => {
    const sourceFile = path.join(sourceDir, "original.jsonl");
    const sessionId = "abc-123";
    const destFile = path.join(destDir, `${sessionId}.jsonl`);

    // Create initial file
    await fs.mkdir(destDir, { recursive: true });
    await fs.writeFile(destFile, "old content", "utf-8");

    // Copy new content
    const newContent = `{"sessionId":"abc-123","updated":true}`;
    await fs.writeFile(sourceFile, newContent, "utf-8");

    await copyTranscript({
      sourceFile,
      destDir,
      sessionId,
    });

    const copiedContent = await fs.readFile(destFile, "utf-8");
    expect(copiedContent).toBe(newContent);
  });

  test("preserves file permissions", async () => {
    const sourceFile = path.join(sourceDir, "original.jsonl");
    const content = `{"sessionId":"abc-123"}`;
    await fs.writeFile(sourceFile, content, "utf-8");

    await copyTranscript({
      sourceFile,
      destDir,
      sessionId: "abc-123",
    });

    const destFile = path.join(destDir, "abc-123.jsonl");
    const stats = await fs.stat(destFile);

    // File should be readable by owner
    // eslint-disable-next-line no-bitwise
    expect(stats.mode & 0o400).toBeTruthy();
  });

  test("handles large files", async () => {
    const sourceFile = path.join(sourceDir, "large.jsonl");
    // Create a ~1MB file with many JSONL lines
    const lines: Array<string> = [];
    for (let i = 0; i < 10000; i++) {
      lines.push(
        JSON.stringify({
          sessionId: "abc-123",
          index: i,
          data: "x".repeat(100),
        }),
      );
    }
    const content = lines.join("\n");
    await fs.writeFile(sourceFile, content, "utf-8");

    await copyTranscript({
      sourceFile,
      destDir,
      sessionId: "abc-123",
    });

    const destFile = path.join(destDir, "abc-123.jsonl");
    const copiedContent = await fs.readFile(destFile, "utf-8");
    expect(copiedContent).toBe(content);
  });
});
