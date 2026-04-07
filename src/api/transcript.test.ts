/**
 * Tests for transcript upload API
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// Mock the base module's auth
vi.mock("./base.js", () => ({
  apiRequest: vi.fn(),
  ConfigManager: {
    loadConfig: () => ({
      organizationUrl: "https://test.nori.ai",
      refreshToken: "test-token",
      username: "test@example.com",
    }),
    isConfigured: () => true,
  },
}));

import { apiRequest } from "./base.js";
import { transcriptApi } from "./transcript.js";

describe("transcriptApi", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("upload", () => {
    test("calls POST /transcripts with sessionId and messages", async () => {
      const mockResponse = {
        id: "transcript-123",
        title: "Test Session",
        sessionId: "session-abc",
        createdAt: "2024-01-01T00:00:00Z",
      };

      vi.mocked(apiRequest).mockResolvedValueOnce(mockResponse);

      const result = await transcriptApi.upload({
        sessionId: "session-abc",
        messages: [
          { type: "user", message: { role: "user", content: "Hello" } },
          {
            type: "assistant",
            message: { role: "assistant", content: "Hi there!" },
          },
        ],
      });

      expect(apiRequest).toHaveBeenCalledWith({
        path: "/transcripts",
        method: "POST",
        body: {
          sessionId: "session-abc",
          messages: [
            { type: "user", message: { role: "user", content: "Hello" } },
            {
              type: "assistant",
              message: { role: "assistant", content: "Hi there!" },
            },
          ],
        },
      });

      expect(result).toEqual(mockResponse);
    });

    test("includes optional title when provided", async () => {
      const mockResponse = {
        id: "transcript-123",
        title: "Custom Title",
        sessionId: "session-abc",
        createdAt: "2024-01-01T00:00:00Z",
      };

      vi.mocked(apiRequest).mockResolvedValueOnce(mockResponse);

      await transcriptApi.upload({
        sessionId: "session-abc",
        messages: [
          { type: "user", message: { role: "user", content: "Hello" } },
        ],
        title: "Custom Title",
      });

      expect(apiRequest).toHaveBeenCalledWith({
        path: "/transcripts",
        method: "POST",
        body: {
          sessionId: "session-abc",
          messages: [
            { type: "user", message: { role: "user", content: "Hello" } },
          ],
          title: "Custom Title",
        },
      });
    });

    test("propagates API errors", async () => {
      vi.mocked(apiRequest).mockRejectedValueOnce(
        new Error(
          "Transcript upload is only available in private instance mode",
        ),
      );

      await expect(
        transcriptApi.upload({
          sessionId: "session-abc",
          messages: [],
        }),
      ).rejects.toThrow("private instance mode");
    });

    test("passes baseUrl built from orgId when orgId is provided", async () => {
      const mockResponse = {
        id: "transcript-123",
        title: "Test Session",
        sessionId: "session-abc",
        createdAt: "2024-01-01T00:00:00Z",
      };

      vi.mocked(apiRequest).mockResolvedValueOnce(mockResponse);

      await transcriptApi.upload({
        sessionId: "session-abc",
        messages: [
          { type: "user", message: { role: "user", content: "Hello" } },
        ],
        orgId: "myorg",
      });

      expect(apiRequest).toHaveBeenCalledWith({
        path: "/transcripts",
        method: "POST",
        body: {
          sessionId: "session-abc",
          messages: [
            { type: "user", message: { role: "user", content: "Hello" } },
          ],
        },
        baseUrl: "https://myorg.noriskillsets.dev",
      });
    });

    test("includes projectName in body when provided", async () => {
      const mockResponse = {
        id: "transcript-123",
        title: "Test Session",
        sessionId: "session-abc",
        createdAt: "2024-01-01T00:00:00Z",
      };

      vi.mocked(apiRequest).mockResolvedValueOnce(mockResponse);

      await transcriptApi.upload({
        sessionId: "session-abc",
        messages: [
          { type: "user", message: { role: "user", content: "Hello" } },
        ],
        projectName: "-Users-ritam-Projects-myapp",
      });

      expect(apiRequest).toHaveBeenCalledWith({
        path: "/transcripts",
        method: "POST",
        body: {
          sessionId: "session-abc",
          messages: [
            { type: "user", message: { role: "user", content: "Hello" } },
          ],
          projectName: "-Users-ritam-Projects-myapp",
        },
      });
    });

    test("does not include projectName in body when not provided", async () => {
      const mockResponse = {
        id: "transcript-123",
        title: "Test Session",
        sessionId: "session-abc",
        createdAt: "2024-01-01T00:00:00Z",
      };

      vi.mocked(apiRequest).mockResolvedValueOnce(mockResponse);

      await transcriptApi.upload({
        sessionId: "session-abc",
        messages: [
          { type: "user", message: { role: "user", content: "Hello" } },
        ],
      });

      const callArgs = vi.mocked(apiRequest).mock.calls[0][0] as {
        body: Record<string, unknown>;
      };
      expect(callArgs.body).not.toHaveProperty("projectName");
    });

    test("does not pass baseUrl when orgId is not provided", async () => {
      const mockResponse = {
        id: "transcript-123",
        title: "Test Session",
        sessionId: "session-abc",
        createdAt: "2024-01-01T00:00:00Z",
      };

      vi.mocked(apiRequest).mockResolvedValueOnce(mockResponse);

      await transcriptApi.upload({
        sessionId: "session-abc",
        messages: [
          { type: "user", message: { role: "user", content: "Hello" } },
        ],
      });

      expect(apiRequest).toHaveBeenCalledWith({
        path: "/transcripts",
        method: "POST",
        body: {
          sessionId: "session-abc",
          messages: [
            { type: "user", message: { role: "user", content: "Hello" } },
          ],
        },
      });
    });

    test("includes skillsetName in body when provided", async () => {
      const mockResponse = {
        id: "transcript-123",
        title: "Test Session",
        sessionId: "session-abc",
        createdAt: "2024-01-01T00:00:00Z",
      };

      vi.mocked(apiRequest).mockResolvedValueOnce(mockResponse);

      await transcriptApi.upload({
        sessionId: "session-abc",
        messages: [
          { type: "user", message: { role: "user", content: "Hello" } },
        ],
        skillsetName: "senior-swe",
      });

      expect(apiRequest).toHaveBeenCalledWith({
        path: "/transcripts",
        method: "POST",
        body: {
          sessionId: "session-abc",
          messages: [
            { type: "user", message: { role: "user", content: "Hello" } },
          ],
          skillsetName: "senior-swe",
        },
      });
    });

    test("does not include skillsetName in body when not provided", async () => {
      const mockResponse = {
        id: "transcript-123",
        title: "Test Session",
        sessionId: "session-abc",
        createdAt: "2024-01-01T00:00:00Z",
      };

      vi.mocked(apiRequest).mockResolvedValueOnce(mockResponse);

      await transcriptApi.upload({
        sessionId: "session-abc",
        messages: [
          { type: "user", message: { role: "user", content: "Hello" } },
        ],
      });

      const callArgs = vi.mocked(apiRequest).mock.calls[0][0] as {
        body: Record<string, unknown>;
      };
      expect(callArgs.body).not.toHaveProperty("skillsetName");
    });
  });
});
