import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import * as apiModule from "@/api/index";
import * as configModule from "@/cli/config";
import * as pathModule from "@/utils/path";

import { exportCursorChat, isEmptyTranscript } from "./cursor-chat-export";
import * as extractorModule from "./cursor-chat-extractor";

// Mock dependencies
vi.mock("@/cli/config");
vi.mock("@/api/index");
vi.mock("@/utils/path");
vi.mock("./cursor-chat-extractor");

describe("cursor-chat-export", () => {
  let tmpDir: string;
  let cursorChatsDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Create temp directory for test databases
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "cursor-export-test-"));
    cursorChatsDir = path.join(tmpDir, ".cursor", "chats");
    await fs.mkdir(cursorChatsDir, { recursive: true });
  });

  afterEach(async () => {
    // Cleanup temp directory
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe("isEmptyTranscript", () => {
    it("should return true for empty content", () => {
      expect(isEmptyTranscript({ content: "" })).toBe(true);
      expect(isEmptyTranscript({ content: "   " })).toBe(true);
    });

    it("should return false for non-empty content", () => {
      const content = JSON.stringify({
        type: "user",
        message: { role: "user", content: "Hello" },
      });
      expect(isEmptyTranscript({ content })).toBe(false);
    });

    it("should return true for content with only non-user messages", () => {
      const content =
        JSON.stringify({
          type: "assistant",
          message: { role: "assistant", content: "Hi" },
        }) +
        "\n" +
        JSON.stringify({
          type: "tool",
          message: { role: "tool", content: "Result" },
        });

      expect(isEmptyTranscript({ content })).toBe(true);
    });

    it("should return false when user messages exist", () => {
      const content =
        JSON.stringify({
          type: "user",
          message: { role: "user", content: "Question" },
        }) +
        "\n" +
        JSON.stringify({
          type: "assistant",
          message: { role: "assistant", content: "Answer" },
        });

      expect(isEmptyTranscript({ content })).toBe(false);
    });
  });

  describe("exportCursorChat", () => {
    it("should export chat and call API with cursor-agent actor", async () => {
      const conversationId = "test-conv-123";

      // Mock ConfigManager
      vi.mocked(apiModule.ConfigManager.isConfigured).mockReturnValue(true);

      // Mock getInstallDirs
      vi.mocked(pathModule.getInstallDirs).mockReturnValue([tmpDir]);

      // Mock loadConfig to return enabled state
      vi.mocked(configModule.loadConfig).mockResolvedValue({
        sendSessionTranscript: "enabled",
        installDir: tmpDir,
      });

      // Mock extractor functions
      const mockDbPath = "/mock/path/store.db";
      vi.mocked(extractorModule.findCursorDatabase).mockResolvedValue(
        mockDbPath,
      );

      vi.mocked(extractorModule.extractMessages).mockResolvedValue([
        { role: "user", content: "Test message" },
      ]);

      vi.mocked(extractorModule.formatForBackend).mockReturnValue(
        JSON.stringify({
          type: "user",
          message: { role: "user", content: "Test message" },
        }),
      );

      // Mock API client
      const mockSummarize = vi.fn().mockResolvedValue({
        summary: "test",
        title: "test",
        transcriptId: "t1",
        summaryId: "s1",
      });

      vi.mocked(apiModule.apiClient.conversation.summarize).mockImplementation(
        mockSummarize,
      );

      // Execute
      await exportCursorChat({
        conversationId,
        status: "completed",
      });

      // Verify API was called with cursor-agent actor
      expect(mockSummarize).toHaveBeenCalledWith({
        content: expect.any(String),
        actor: "cursor-agent",
      });
    });

    it("should skip export when sendSessionTranscript is disabled", async () => {
      const conversationId = "test-conv-456";

      // Mock ConfigManager
      vi.mocked(apiModule.ConfigManager.isConfigured).mockReturnValue(true);

      // Mock getInstallDirs
      vi.mocked(pathModule.getInstallDirs).mockReturnValue([tmpDir]);

      // Mock loadConfig to return disabled state
      vi.mocked(configModule.loadConfig).mockResolvedValue({
        sendSessionTranscript: "disabled",
        installDir: tmpDir,
      });

      const mockSummarize = vi.fn();
      vi.mocked(apiModule.apiClient.conversation.summarize).mockImplementation(
        mockSummarize,
      );

      // Execute
      await exportCursorChat({
        conversationId,
        status: "completed",
      });

      // Verify API was NOT called
      expect(mockSummarize).not.toHaveBeenCalled();
    });

    it("should skip export when Nori is not configured", async () => {
      const conversationId = "test-conv-789";

      // Mock ConfigManager as not configured
      vi.mocked(apiModule.ConfigManager.isConfigured).mockReturnValue(false);

      const mockSummarize = vi.fn();
      vi.mocked(apiModule.apiClient.conversation.summarize).mockImplementation(
        mockSummarize,
      );

      // Execute
      await exportCursorChat({
        conversationId,
        status: "completed",
      });

      // Verify API was NOT called
      expect(mockSummarize).not.toHaveBeenCalled();
    });

    it("should skip export when transcript is empty", async () => {
      const conversationId = "test-conv-empty";

      // Mock ConfigManager
      vi.mocked(apiModule.ConfigManager.isConfigured).mockReturnValue(true);

      // Mock getInstallDirs
      vi.mocked(pathModule.getInstallDirs).mockReturnValue([tmpDir]);

      // Mock loadConfig
      vi.mocked(configModule.loadConfig).mockResolvedValue({
        sendSessionTranscript: "enabled",
        installDir: tmpDir,
      });

      // Mock extractor to return empty messages
      vi.mocked(extractorModule.findCursorDatabase).mockResolvedValue(
        "/mock/db",
      );
      vi.mocked(extractorModule.extractMessages).mockResolvedValue([]);
      vi.mocked(extractorModule.formatForBackend).mockReturnValue("");

      const mockSummarize = vi.fn();
      vi.mocked(apiModule.apiClient.conversation.summarize).mockImplementation(
        mockSummarize,
      );

      // Execute
      await exportCursorChat({
        conversationId,
        status: "completed",
      });

      // Verify API was NOT called for empty transcript
      expect(mockSummarize).not.toHaveBeenCalled();
    });

    it("should handle errors gracefully without throwing", async () => {
      const conversationId = "test-conv-error";

      // Mock ConfigManager
      vi.mocked(apiModule.ConfigManager.isConfigured).mockReturnValue(true);

      // Mock getInstallDirs
      vi.mocked(pathModule.getInstallDirs).mockReturnValue([tmpDir]);

      // Mock loadConfig
      vi.mocked(configModule.loadConfig).mockResolvedValue({
        sendSessionTranscript: "enabled",
        installDir: tmpDir,
      });

      // Mock extractor to throw error
      vi.mocked(extractorModule.findCursorDatabase).mockRejectedValue(
        new Error("Database not found"),
      );

      // Execute - should not throw
      await expect(
        exportCursorChat({
          conversationId,
          status: "completed",
        }),
      ).resolves.toBeUndefined();
    });
  });
});
