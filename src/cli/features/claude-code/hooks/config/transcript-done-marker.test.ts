/**
 * Tests for transcript done marker hook
 *
 * This hook runs at SessionEnd and writes a .done marker file
 * to signal that a session has completed and is ready for upload.
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { writeTranscriptDoneMarker } from "./transcript-done-marker.js";

describe("transcript-done-marker hook", () => {
  let tempDir: string;
  let originalHome: string | undefined;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "transcript-marker-test-"),
    );

    // Create mock directories
    await fs.mkdir(path.join(tempDir, ".nori", "transcripts", "claude-code"), {
      recursive: true,
    });
    await fs.mkdir(path.join(tempDir, ".claude", "projects"), {
      recursive: true,
    });

    // Save original HOME and override for tests
    originalHome = process.env.HOME;
    process.env.HOME = tempDir;
  });

  afterEach(async () => {
    // Restore HOME
    if (originalHome) {
      process.env.HOME = originalHome;
    }

    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe("writeTranscriptDoneMarker", () => {
    test("writes .done marker file to transcript directory", async () => {
      // Create a transcript file in the expected location
      const projectDir = "-Users-test-project";
      const sessionId = "abc123-def456-ghi789";
      const transcriptDir = path.join(
        tempDir,
        ".nori",
        "transcripts",
        "claude-code",
        projectDir,
      );
      await fs.mkdir(transcriptDir, { recursive: true });

      const transcriptPath = path.join(transcriptDir, `${sessionId}.jsonl`);
      await fs.writeFile(
        transcriptPath,
        `{"sessionId":"${sessionId}","type":"user","message":{"role":"user","content":"Hello"}}`,
      );

      await writeTranscriptDoneMarker({
        transcriptPath,
        sessionId,
      });

      // Check that .done marker was created
      const markerPath = path.join(transcriptDir, `${sessionId}.done`);
      await expect(fs.access(markerPath)).resolves.not.toThrow();
    });

    test("creates directory if it does not exist", async () => {
      const projectDir = "-Users-new-project";
      const sessionId = "new-session-id";
      const transcriptDir = path.join(
        tempDir,
        ".nori",
        "transcripts",
        "claude-code",
        projectDir,
      );
      // Don't create the directory - let the function create it

      const transcriptPath = path.join(transcriptDir, `${sessionId}.jsonl`);

      await writeTranscriptDoneMarker({
        transcriptPath,
        sessionId,
      });

      // Check that .done marker was created in new directory
      const markerPath = path.join(transcriptDir, `${sessionId}.done`);
      await expect(fs.access(markerPath)).resolves.not.toThrow();
    });

    test("marker file is empty", async () => {
      const projectDir = "-Users-test-project";
      const sessionId = "session-empty-marker";
      const transcriptDir = path.join(
        tempDir,
        ".nori",
        "transcripts",
        "claude-code",
        projectDir,
      );
      await fs.mkdir(transcriptDir, { recursive: true });

      const transcriptPath = path.join(transcriptDir, `${sessionId}.jsonl`);
      await fs.writeFile(
        transcriptPath,
        '{"sessionId":"session-empty-marker"}',
      );

      await writeTranscriptDoneMarker({
        transcriptPath,
        sessionId,
      });

      const markerPath = path.join(transcriptDir, `${sessionId}.done`);
      const content = await fs.readFile(markerPath, "utf-8");
      expect(content).toBe("");
    });

    test("handles errors gracefully without throwing", async () => {
      // Try to write to an invalid path - should not throw
      await expect(
        writeTranscriptDoneMarker({
          transcriptPath: "/nonexistent/path/transcript.jsonl",
          sessionId: "test-session",
        }),
      ).resolves.not.toThrow();
    });
  });
});
