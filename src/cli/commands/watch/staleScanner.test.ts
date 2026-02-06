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

  test("returns empty arrays when directory is empty", async () => {
    const result = await findStaleTranscripts({
      transcriptDir: tempDir,
      staleThresholdMs: 1000,
      expireThresholdMs: 10000,
    });

    expect(result).toEqual({ staleFiles: [], expiredFiles: [] });
  });

  test("returns empty arrays when directory does not exist", async () => {
    const result = await findStaleTranscripts({
      transcriptDir: path.join(tempDir, "nonexistent"),
      staleThresholdMs: 1000,
      expireThresholdMs: 10000,
    });

    expect(result).toEqual({ staleFiles: [], expiredFiles: [] });
  });

  test("returns stale files older than stale threshold but younger than expire threshold", async () => {
    // Create a file
    const filePath = path.join(tempDir, "stale-session.jsonl");
    await fs.writeFile(filePath, '{"sessionId": "stale"}');

    // Set mtime to 2 seconds ago (stale but not expired)
    const staleTime = new Date(Date.now() - 2000);
    await fs.utimes(filePath, staleTime, staleTime);

    const result = await findStaleTranscripts({
      transcriptDir: tempDir,
      staleThresholdMs: 1000, // 1 second threshold
      expireThresholdMs: 10000, // 10 second expire threshold
    });

    expect(result.staleFiles).toEqual([filePath]);
    expect(result.expiredFiles).toEqual([]);
  });

  test("returns expired files older than expire threshold", async () => {
    // Create a file
    const filePath = path.join(tempDir, "expired-session.jsonl");
    await fs.writeFile(filePath, '{"sessionId": "expired"}');

    // Set mtime to 20 seconds ago (expired)
    const expiredTime = new Date(Date.now() - 20000);
    await fs.utimes(filePath, expiredTime, expiredTime);

    const result = await findStaleTranscripts({
      transcriptDir: tempDir,
      staleThresholdMs: 1000, // 1 second threshold
      expireThresholdMs: 10000, // 10 second expire threshold
    });

    expect(result.staleFiles).toEqual([]);
    expect(result.expiredFiles).toEqual([filePath]);
  });

  test("ignores files newer than stale threshold", async () => {
    // Create a file (will have current mtime)
    const filePath = path.join(tempDir, "fresh-session.jsonl");
    await fs.writeFile(filePath, '{"sessionId": "fresh"}');

    const result = await findStaleTranscripts({
      transcriptDir: tempDir,
      staleThresholdMs: 60000, // 60 second threshold - file is definitely newer
      expireThresholdMs: 120000,
    });

    expect(result.staleFiles).toEqual([]);
    expect(result.expiredFiles).toEqual([]);
  });

  test("only returns .jsonl files", async () => {
    // Create various files
    const jsonlPath = path.join(tempDir, "session.jsonl");
    const txtPath = path.join(tempDir, "session.txt");
    const donePath = path.join(tempDir, "session.done");

    await fs.writeFile(jsonlPath, '{"sessionId": "test"}');
    await fs.writeFile(txtPath, "text content");
    await fs.writeFile(donePath, "");

    // Make all files stale (but not expired)
    const staleTime = new Date(Date.now() - 2000);
    await fs.utimes(jsonlPath, staleTime, staleTime);
    await fs.utimes(txtPath, staleTime, staleTime);
    await fs.utimes(donePath, staleTime, staleTime);

    const result = await findStaleTranscripts({
      transcriptDir: tempDir,
      staleThresholdMs: 1000,
      expireThresholdMs: 10000,
    });

    expect(result.staleFiles).toEqual([jsonlPath]);
    expect(result.expiredFiles).toEqual([]);
  });

  test("recursively scans subdirectories", async () => {
    // Create nested directory structure
    const projectDir = path.join(tempDir, "project-a");
    await fs.mkdir(projectDir, { recursive: true });

    const filePath = path.join(projectDir, "session.jsonl");
    await fs.writeFile(filePath, '{"sessionId": "nested"}');

    // Make file stale
    const staleTime = new Date(Date.now() - 2000);
    await fs.utimes(filePath, staleTime, staleTime);

    const result = await findStaleTranscripts({
      transcriptDir: tempDir,
      staleThresholdMs: 1000,
      expireThresholdMs: 10000,
    });

    expect(result.staleFiles).toEqual([filePath]);
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

    // Make all files stale
    const staleTime = new Date(Date.now() - 2000);
    await fs.utimes(file1, staleTime, staleTime);
    await fs.utimes(file2, staleTime, staleTime);
    await fs.utimes(file3, staleTime, staleTime);

    const result = await findStaleTranscripts({
      transcriptDir: tempDir,
      staleThresholdMs: 1000,
      expireThresholdMs: 10000,
    });

    expect(result.staleFiles).toHaveLength(3);
    expect(result.staleFiles).toContain(file1);
    expect(result.staleFiles).toContain(file2);
    expect(result.staleFiles).toContain(file3);
  });

  test("separates stale and expired files correctly", async () => {
    const staleFile = path.join(tempDir, "stale.jsonl");
    const expiredFile = path.join(tempDir, "expired.jsonl");
    const freshFile = path.join(tempDir, "fresh.jsonl");

    await fs.writeFile(staleFile, '{"sessionId": "stale"}');
    await fs.writeFile(expiredFile, '{"sessionId": "expired"}');
    await fs.writeFile(freshFile, '{"sessionId": "fresh"}');

    // Make one file stale (5 seconds old)
    const staleTime = new Date(Date.now() - 5000);
    await fs.utimes(staleFile, staleTime, staleTime);

    // Make one file expired (20 seconds old)
    const expiredTime = new Date(Date.now() - 20000);
    await fs.utimes(expiredFile, expiredTime, expiredTime);

    // Fresh file keeps current mtime

    const result = await findStaleTranscripts({
      transcriptDir: tempDir,
      staleThresholdMs: 2000, // 2 seconds
      expireThresholdMs: 10000, // 10 seconds
    });

    expect(result.staleFiles).toEqual([staleFile]);
    expect(result.expiredFiles).toEqual([expiredFile]);
  });

  test("mixes stale, expired, and fresh files correctly", async () => {
    const staleFile = path.join(tempDir, "stale.jsonl");
    const freshFile = path.join(tempDir, "fresh.jsonl");

    await fs.writeFile(staleFile, '{"sessionId": "stale"}');
    await fs.writeFile(freshFile, '{"sessionId": "fresh"}');

    // Only make one file stale
    const staleTime = new Date(Date.now() - 2000);
    await fs.utimes(staleFile, staleTime, staleTime);

    const result = await findStaleTranscripts({
      transcriptDir: tempDir,
      staleThresholdMs: 1000,
      expireThresholdMs: 10000,
    });

    expect(result.staleFiles).toEqual([staleFile]);
    expect(result.expiredFiles).toEqual([]);
  });
});
