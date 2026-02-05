/**
 * Tests for stale transcript scanner
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { findStaleTranscripts } from "./staleScanner.js";

describe("findStaleTranscripts", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "stale-scanner-test-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test("returns empty array when directory is empty", async () => {
    const result = await findStaleTranscripts({
      transcriptDir: tempDir,
      maxAgeMs: 1000,
    });

    expect(result).toEqual([]);
  });

  test("returns empty array when directory does not exist", async () => {
    const result = await findStaleTranscripts({
      transcriptDir: path.join(tempDir, "nonexistent"),
      maxAgeMs: 1000,
    });

    expect(result).toEqual([]);
  });

  test("returns files older than threshold", async () => {
    // Create a file
    const filePath = path.join(tempDir, "old-session.jsonl");
    await fs.writeFile(filePath, '{"sessionId": "old"}');

    // Set mtime to 2 seconds ago
    const oldTime = new Date(Date.now() - 2000);
    await fs.utimes(filePath, oldTime, oldTime);

    const result = await findStaleTranscripts({
      transcriptDir: tempDir,
      maxAgeMs: 1000, // 1 second threshold
    });

    expect(result).toEqual([filePath]);
  });

  test("ignores files newer than threshold", async () => {
    // Create a file (will have current mtime)
    const filePath = path.join(tempDir, "fresh-session.jsonl");
    await fs.writeFile(filePath, '{"sessionId": "fresh"}');

    const result = await findStaleTranscripts({
      transcriptDir: tempDir,
      maxAgeMs: 60000, // 60 second threshold - file is definitely newer
    });

    expect(result).toEqual([]);
  });

  test("only returns .jsonl files", async () => {
    // Create various files
    const jsonlPath = path.join(tempDir, "session.jsonl");
    const txtPath = path.join(tempDir, "session.txt");
    const donePath = path.join(tempDir, "session.done");

    await fs.writeFile(jsonlPath, '{"sessionId": "test"}');
    await fs.writeFile(txtPath, "text content");
    await fs.writeFile(donePath, "");

    // Make all files old
    const oldTime = new Date(Date.now() - 2000);
    await fs.utimes(jsonlPath, oldTime, oldTime);
    await fs.utimes(txtPath, oldTime, oldTime);
    await fs.utimes(donePath, oldTime, oldTime);

    const result = await findStaleTranscripts({
      transcriptDir: tempDir,
      maxAgeMs: 1000,
    });

    expect(result).toEqual([jsonlPath]);
  });

  test("recursively scans subdirectories", async () => {
    // Create nested directory structure
    const projectDir = path.join(tempDir, "project-a");
    await fs.mkdir(projectDir, { recursive: true });

    const filePath = path.join(projectDir, "session.jsonl");
    await fs.writeFile(filePath, '{"sessionId": "nested"}');

    // Make file old
    const oldTime = new Date(Date.now() - 2000);
    await fs.utimes(filePath, oldTime, oldTime);

    const result = await findStaleTranscripts({
      transcriptDir: tempDir,
      maxAgeMs: 1000,
    });

    expect(result).toEqual([filePath]);
  });

  test("returns multiple stale files from different directories", async () => {
    // Create files in multiple subdirectories
    const dir1 = path.join(tempDir, "project-a");
    const dir2 = path.join(tempDir, "project-b");
    await fs.mkdir(dir1, { recursive: true });
    await fs.mkdir(dir2, { recursive: true });

    const file1 = path.join(dir1, "session1.jsonl");
    const file2 = path.join(dir2, "session2.jsonl");
    const file3 = path.join(tempDir, "session3.jsonl");

    await fs.writeFile(file1, '{"sessionId": "1"}');
    await fs.writeFile(file2, '{"sessionId": "2"}');
    await fs.writeFile(file3, '{"sessionId": "3"}');

    // Make all files old
    const oldTime = new Date(Date.now() - 2000);
    await fs.utimes(file1, oldTime, oldTime);
    await fs.utimes(file2, oldTime, oldTime);
    await fs.utimes(file3, oldTime, oldTime);

    const result = await findStaleTranscripts({
      transcriptDir: tempDir,
      maxAgeMs: 1000,
    });

    expect(result).toHaveLength(3);
    expect(result).toContain(file1);
    expect(result).toContain(file2);
    expect(result).toContain(file3);
  });

  test("mixes stale and fresh files correctly", async () => {
    const staleFile = path.join(tempDir, "stale.jsonl");
    const freshFile = path.join(tempDir, "fresh.jsonl");

    await fs.writeFile(staleFile, '{"sessionId": "stale"}');
    await fs.writeFile(freshFile, '{"sessionId": "fresh"}');

    // Only make one file old
    const oldTime = new Date(Date.now() - 2000);
    await fs.utimes(staleFile, oldTime, oldTime);

    const result = await findStaleTranscripts({
      transcriptDir: tempDir,
      maxAgeMs: 1000,
    });

    expect(result).toEqual([staleFile]);
  });
});
