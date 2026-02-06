/**
 * Tests for transcript registry
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { TranscriptRegistry } from "./transcriptRegistry.js";

describe("TranscriptRegistry", () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "transcript-registry-test-"),
    );
    dbPath = path.join(tempDir, "registry.db");
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test("creates database and table on first use", async () => {
    const registry = new TranscriptRegistry({ dbPath });

    // Database file should exist after construction
    const exists = await fs
      .stat(dbPath)
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(true);

    registry.close();
  });

  test("isUploaded returns false for unknown sessionId", () => {
    const registry = new TranscriptRegistry({ dbPath });

    const result = registry.isUploaded({
      sessionId: "unknown-session",
      fileHash: "abc123",
    });

    expect(result).toBe(false);

    registry.close();
  });

  test("isUploaded returns true after markUploaded with same hash", () => {
    const registry = new TranscriptRegistry({ dbPath });

    registry.markUploaded({
      sessionId: "session-123",
      fileHash: "hash-abc",
      transcriptPath: "/path/to/transcript.jsonl",
    });

    const result = registry.isUploaded({
      sessionId: "session-123",
      fileHash: "hash-abc",
    });

    expect(result).toBe(true);

    registry.close();
  });

  test("isUploaded returns false when hash differs", () => {
    const registry = new TranscriptRegistry({ dbPath });

    registry.markUploaded({
      sessionId: "session-123",
      fileHash: "hash-abc",
      transcriptPath: "/path/to/transcript.jsonl",
    });

    // Same sessionId but different hash - file has changed
    const result = registry.isUploaded({
      sessionId: "session-123",
      fileHash: "hash-different",
    });

    expect(result).toBe(false);

    registry.close();
  });

  test("markUploaded updates existing record when called again", () => {
    const registry = new TranscriptRegistry({ dbPath });

    // First upload
    registry.markUploaded({
      sessionId: "session-123",
      fileHash: "hash-v1",
      transcriptPath: "/path/to/transcript.jsonl",
    });

    expect(
      registry.isUploaded({ sessionId: "session-123", fileHash: "hash-v1" }),
    ).toBe(true);

    // Second upload with new hash (re-upload scenario)
    registry.markUploaded({
      sessionId: "session-123",
      fileHash: "hash-v2",
      transcriptPath: "/path/to/transcript.jsonl",
    });

    // Old hash should no longer match
    expect(
      registry.isUploaded({ sessionId: "session-123", fileHash: "hash-v1" }),
    ).toBe(false);

    // New hash should match
    expect(
      registry.isUploaded({ sessionId: "session-123", fileHash: "hash-v2" }),
    ).toBe(true);

    registry.close();
  });

  test("persists data across registry instances", async () => {
    // First instance - write data
    const registry1 = new TranscriptRegistry({ dbPath });
    registry1.markUploaded({
      sessionId: "session-persist",
      fileHash: "hash-persist",
      transcriptPath: "/path/to/transcript.jsonl",
    });
    registry1.close();

    // Second instance - read data
    const registry2 = new TranscriptRegistry({ dbPath });
    const result = registry2.isUploaded({
      sessionId: "session-persist",
      fileHash: "hash-persist",
    });

    expect(result).toBe(true);

    registry2.close();
  });

  test("handles multiple sessions independently", () => {
    const registry = new TranscriptRegistry({ dbPath });

    registry.markUploaded({
      sessionId: "session-1",
      fileHash: "hash-1",
      transcriptPath: "/path/to/session1.jsonl",
    });

    registry.markUploaded({
      sessionId: "session-2",
      fileHash: "hash-2",
      transcriptPath: "/path/to/session2.jsonl",
    });

    expect(
      registry.isUploaded({ sessionId: "session-1", fileHash: "hash-1" }),
    ).toBe(true);
    expect(
      registry.isUploaded({ sessionId: "session-2", fileHash: "hash-2" }),
    ).toBe(true);
    expect(
      registry.isUploaded({ sessionId: "session-1", fileHash: "hash-2" }),
    ).toBe(false);
    expect(
      registry.isUploaded({ sessionId: "session-2", fileHash: "hash-1" }),
    ).toBe(false);

    registry.close();
  });
});
