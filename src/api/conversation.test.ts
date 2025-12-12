import { describe, it, expect, vi, beforeEach } from "vitest";

import * as baseModule from "./base";
import { conversationApi } from "./conversation";

// Mock the base module
vi.mock("./base", () => ({
  apiRequest: vi.fn(),
}));

describe("conversationApi", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("summarize", () => {
    it("should send claude-code actor by default", async () => {
      const mockResponse = {
        summary: "test summary",
        title: "test title",
        transcriptId: "transcript-123",
        summaryId: "summary-123",
      };

      vi.mocked(baseModule.apiRequest).mockResolvedValue(mockResponse);

      const result = await conversationApi.summarize({
        content: "test content",
      });

      expect(baseModule.apiRequest).toHaveBeenCalledWith({
        path: "/conversation/summarize",
        method: "POST",
        body: {
          content: "test content",
          actor: "claude-code",
        },
      });

      expect(result).toEqual(mockResponse);
    });

    it("should support cursor-agent actor", async () => {
      const mockResponse = {
        summary: "cursor summary",
        title: "cursor title",
        transcriptId: "transcript-456",
        summaryId: "summary-456",
      };

      vi.mocked(baseModule.apiRequest).mockResolvedValue(mockResponse);

      const result = await conversationApi.summarize({
        content: "cursor chat content",
        actor: "cursor-agent",
      });

      expect(baseModule.apiRequest).toHaveBeenCalledWith({
        path: "/conversation/summarize",
        method: "POST",
        body: {
          content: "cursor chat content",
          actor: "cursor-agent",
        },
      });

      expect(result).toEqual(mockResponse);
    });

    it("should use provided actor when specified", async () => {
      const mockResponse = {
        summary: "test",
        title: "test",
        transcriptId: "t1",
        summaryId: "s1",
      };

      vi.mocked(baseModule.apiRequest).mockResolvedValue(mockResponse);

      await conversationApi.summarize({
        content: "content",
        actor: "claude-code",
      });

      expect(baseModule.apiRequest).toHaveBeenCalledWith({
        path: "/conversation/summarize",
        method: "POST",
        body: {
          content: "content",
          actor: "claude-code",
        },
      });
    });
  });
});
