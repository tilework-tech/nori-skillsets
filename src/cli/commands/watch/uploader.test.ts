/**
 * Tests for transcript uploader
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// Mock the transcript API
vi.mock("@/api/transcript.js", () => ({
  transcriptApi: {
    upload: vi.fn(),
  },
}));

import { transcriptApi } from "@/api/transcript.js";

import { processTranscriptForUpload } from "./uploader.js";

describe("uploader", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "uploader-test-"));
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  describe("processTranscriptForUpload", () => {
    test("reads JSONL file and uploads transcript", async () => {
      // Create a transcript file
      const transcriptPath = path.join(tempDir, "session-123.jsonl");
      const transcriptContent = [
        '{"type":"summary","summary":"Test session"}',
        '{"sessionId":"session-123","type":"user","message":{"role":"user","content":"Hello"}}',
        '{"sessionId":"session-123","type":"assistant","message":{"role":"assistant","content":"Hi there!"}}',
      ].join("\n");
      await fs.writeFile(transcriptPath, transcriptContent);

      vi.mocked(transcriptApi.upload).mockResolvedValueOnce({
        id: "transcript-id",
        title: "Test session",
        sessionId: "session-123",
        createdAt: "2024-01-01T00:00:00Z",
      });

      const result = await processTranscriptForUpload({
        transcriptPath,
      });

      expect(result).toBe(true);
      expect(transcriptApi.upload).toHaveBeenCalledWith({
        sessionId: "session-123",
        messages: expect.arrayContaining([
          expect.objectContaining({ type: "summary" }),
          expect.objectContaining({ type: "user" }),
          expect.objectContaining({ type: "assistant" }),
        ]),
      });
    });

    test("preserves transcript file on successful upload", async () => {
      const transcriptPath = path.join(tempDir, "session-123.jsonl");
      await fs.writeFile(
        transcriptPath,
        '{"sessionId":"session-123","type":"user","message":{"role":"user","content":"Hello"}}',
      );

      vi.mocked(transcriptApi.upload).mockResolvedValueOnce({
        id: "transcript-id",
        title: "Test",
        sessionId: "session-123",
        createdAt: "2024-01-01T00:00:00Z",
      });

      await processTranscriptForUpload({ transcriptPath });

      // File should still exist — deletion is caller's responsibility
      await expect(fs.access(transcriptPath)).resolves.not.toThrow();
    });

    test("preserves files on upload failure", async () => {
      const transcriptPath = path.join(tempDir, "session-123.jsonl");

      await fs.writeFile(
        transcriptPath,
        '{"sessionId":"session-123","type":"user","message":{"role":"user","content":"Hello"}}',
      );

      vi.mocked(transcriptApi.upload).mockRejectedValueOnce(
        new Error("Upload failed"),
      );

      const result = await processTranscriptForUpload({
        transcriptPath,
      });

      expect(result).toBe(false);

      // File should still exist
      await expect(fs.access(transcriptPath)).resolves.not.toThrow();
    });

    test("returns false when transcript has no sessionId", async () => {
      const transcriptPath = path.join(tempDir, "no-session.jsonl");
      await fs.writeFile(
        transcriptPath,
        '{"type":"summary","summary":"No session ID here"}',
      );

      const result = await processTranscriptForUpload({ transcriptPath });

      expect(result).toBe(false);
      expect(transcriptApi.upload).not.toHaveBeenCalled();

      // File should still exist (not deleted)
      await expect(fs.access(transcriptPath)).resolves.not.toThrow();
    });

    test("returns false when transcript file does not exist", async () => {
      const result = await processTranscriptForUpload({
        transcriptPath: path.join(tempDir, "nonexistent.jsonl"),
      });

      expect(result).toBe(false);
      expect(transcriptApi.upload).not.toHaveBeenCalled();
    });

    test("handles malformed JSON lines gracefully", async () => {
      const transcriptPath = path.join(tempDir, "malformed.jsonl");
      const transcriptContent = [
        "not valid json",
        '{"sessionId":"session-123","type":"user","message":{"role":"user","content":"Hello"}}',
        "another bad line",
      ].join("\n");
      await fs.writeFile(transcriptPath, transcriptContent);

      vi.mocked(transcriptApi.upload).mockResolvedValueOnce({
        id: "transcript-id",
        title: "Test",
        sessionId: "session-123",
        createdAt: "2024-01-01T00:00:00Z",
      });

      const result = await processTranscriptForUpload({ transcriptPath });

      expect(result).toBe(true);
      // Should only include the valid message
      expect(transcriptApi.upload).toHaveBeenCalledWith({
        sessionId: "session-123",
        messages: [
          expect.objectContaining({
            sessionId: "session-123",
            type: "user",
          }),
        ],
      });
    });

    test("passes orgId to transcriptApi.upload when provided", async () => {
      const transcriptPath = path.join(tempDir, "session-123.jsonl");
      await fs.writeFile(
        transcriptPath,
        '{"sessionId":"session-123","type":"user","message":{"role":"user","content":"Hello"}}',
      );

      vi.mocked(transcriptApi.upload).mockResolvedValueOnce({
        id: "transcript-id",
        title: "Test",
        sessionId: "session-123",
        createdAt: "2024-01-01T00:00:00Z",
      });

      await processTranscriptForUpload({
        transcriptPath,
        orgId: "myorg",
      });

      expect(transcriptApi.upload).toHaveBeenCalledWith({
        sessionId: "session-123",
        messages: expect.any(Array),
        orgId: "myorg",
      });
    });

    test("does not pass orgId when not provided", async () => {
      const transcriptPath = path.join(tempDir, "session-123.jsonl");
      await fs.writeFile(
        transcriptPath,
        '{"sessionId":"session-123","type":"user","message":{"role":"user","content":"Hello"}}',
      );

      vi.mocked(transcriptApi.upload).mockResolvedValueOnce({
        id: "transcript-id",
        title: "Test",
        sessionId: "session-123",
        createdAt: "2024-01-01T00:00:00Z",
      });

      await processTranscriptForUpload({ transcriptPath });

      expect(transcriptApi.upload).toHaveBeenCalledWith({
        sessionId: "session-123",
        messages: expect.any(Array),
      });
    });
    test("passes projectName to transcriptApi.upload when provided", async () => {
      const transcriptPath = path.join(tempDir, "session-123.jsonl");
      await fs.writeFile(
        transcriptPath,
        '{"sessionId":"session-123","type":"user","message":{"role":"user","content":"Hello"}}',
      );

      vi.mocked(transcriptApi.upload).mockResolvedValueOnce({
        id: "transcript-id",
        title: "Test",
        sessionId: "session-123",
        createdAt: "2024-01-01T00:00:00Z",
      });

      await processTranscriptForUpload({
        transcriptPath,
        projectName: "-Users-ritam-Projects-myapp",
      });

      expect(transcriptApi.upload).toHaveBeenCalledWith({
        sessionId: "session-123",
        messages: expect.any(Array),
        projectName: "-Users-ritam-Projects-myapp",
      });
    });

    test("does not pass projectName when not provided", async () => {
      const transcriptPath = path.join(tempDir, "session-123.jsonl");
      await fs.writeFile(
        transcriptPath,
        '{"sessionId":"session-123","type":"user","message":{"role":"user","content":"Hello"}}',
      );

      vi.mocked(transcriptApi.upload).mockResolvedValueOnce({
        id: "transcript-id",
        title: "Test",
        sessionId: "session-123",
        createdAt: "2024-01-01T00:00:00Z",
      });

      await processTranscriptForUpload({ transcriptPath });

      expect(transcriptApi.upload).toHaveBeenCalledWith({
        sessionId: "session-123",
        messages: expect.any(Array),
      });
    });

    test("passes skillsetName to transcriptApi.upload when provided", async () => {
      const transcriptPath = path.join(tempDir, "session-123.jsonl");
      await fs.writeFile(
        transcriptPath,
        '{"sessionId":"session-123","type":"user","message":{"role":"user","content":"Hello"}}',
      );

      vi.mocked(transcriptApi.upload).mockResolvedValueOnce({
        id: "transcript-id",
        title: "Test",
        sessionId: "session-123",
        createdAt: "2024-01-01T00:00:00Z",
      });

      await processTranscriptForUpload({
        transcriptPath,
        skillsetName: "senior-swe",
      });

      expect(transcriptApi.upload).toHaveBeenCalledWith({
        sessionId: "session-123",
        messages: expect.any(Array),
        skillsetName: "senior-swe",
      });
    });

    test("does not pass skillsetName when not provided", async () => {
      const transcriptPath = path.join(tempDir, "session-123.jsonl");
      await fs.writeFile(
        transcriptPath,
        '{"sessionId":"session-123","type":"user","message":{"role":"user","content":"Hello"}}',
      );

      vi.mocked(transcriptApi.upload).mockResolvedValueOnce({
        id: "transcript-id",
        title: "Test",
        sessionId: "session-123",
        createdAt: "2024-01-01T00:00:00Z",
      });

      await processTranscriptForUpload({ transcriptPath });

      const callArgs = vi.mocked(transcriptApi.upload).mock.calls[0][0];
      expect(callArgs).not.toHaveProperty("skillsetName");
    });
  });
});
