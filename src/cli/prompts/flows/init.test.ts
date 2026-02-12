/**
 * Tests for init flow module
 *
 * These tests verify the initFlow function behavior including:
 * - Happy path: callbacks invoked correctly, result returned
 * - Existing config: profile name collected, capture callback invoked
 * - Ancestor warnings don't block init
 * - Decline/cancel at each prompt returns null without side effects
 * - skipWarning and skipIntro parameter behavior
 */

import * as clack from "@clack/prompts";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { initFlow, type InitFlowCallbacks } from "./init.js";

vi.mock("@clack/prompts", () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  confirm: vi.fn(),
  text: vi.fn(),
  spinner: vi.fn(() => ({
    start: vi.fn(),
    stop: vi.fn(),
    message: vi.fn(),
  })),
  note: vi.fn(),
  log: {
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    message: vi.fn(),
  },
  isCancel: vi.fn(() => false),
  cancel: vi.fn(),
}));

describe("initFlow", () => {
  let mockCallbacks: InitFlowCallbacks;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(clack.isCancel).mockReturnValue(false);

    mockCallbacks = {
      onCheckAncestors: vi.fn().mockResolvedValue([]),
      onDetectExistingConfig: vi.fn().mockResolvedValue(null),
      onCaptureConfig: vi.fn().mockResolvedValue(undefined),
      onInit: vi.fn().mockResolvedValue(undefined),
    };
  });

  describe("happy path: no existing config", () => {
    it("should call onCheckAncestors with install dir", async () => {
      vi.mocked(clack.confirm).mockResolvedValueOnce(true);

      await initFlow({
        installDir: "/test/dir",
        callbacks: mockCallbacks,
      });

      expect(mockCallbacks.onCheckAncestors).toHaveBeenCalledWith({
        installDir: "/test/dir",
      });
    });

    it("should call onDetectExistingConfig with install dir", async () => {
      vi.mocked(clack.confirm).mockResolvedValueOnce(true);

      await initFlow({
        installDir: "/test/dir",
        callbacks: mockCallbacks,
      });

      expect(mockCallbacks.onDetectExistingConfig).toHaveBeenCalledWith({
        installDir: "/test/dir",
      });
    });

    it("should call onInit with install dir and null profile name", async () => {
      vi.mocked(clack.confirm).mockResolvedValueOnce(true);

      await initFlow({
        installDir: "/test/dir",
        callbacks: mockCallbacks,
      });

      expect(mockCallbacks.onInit).toHaveBeenCalledWith({
        installDir: "/test/dir",
        capturedProfileName: null,
      });
    });

    it("should return result with null capturedProfileName", async () => {
      vi.mocked(clack.confirm).mockResolvedValueOnce(true);

      const result = await initFlow({
        installDir: "/test/dir",
        callbacks: mockCallbacks,
      });

      expect(result).toEqual({ capturedProfileName: null });
    });
  });

  describe("happy path: existing config detected", () => {
    it("should prompt for profile name with text input", async () => {
      vi.mocked(clack.confirm).mockResolvedValueOnce(true);
      vi.mocked(mockCallbacks.onDetectExistingConfig).mockResolvedValueOnce({
        hasClaudeMd: true,
        hasManagedBlock: false,
        hasSkills: false,
        skillCount: 0,
        hasAgents: false,
        agentCount: 0,
        hasCommands: false,
        commandCount: 0,
      });
      vi.mocked(clack.text).mockResolvedValueOnce("my-config");

      await initFlow({
        installDir: "/test/dir",
        callbacks: mockCallbacks,
      });

      expect(clack.text).toHaveBeenCalledTimes(1);
      const textCall = vi.mocked(clack.text).mock.calls[0][0];
      expect(textCall.validate).toBeDefined();
    });

    it("should call onCaptureConfig with install dir and profile name", async () => {
      vi.mocked(clack.confirm).mockResolvedValueOnce(true);
      vi.mocked(mockCallbacks.onDetectExistingConfig).mockResolvedValueOnce({
        hasClaudeMd: true,
        hasManagedBlock: false,
        hasSkills: false,
        skillCount: 0,
        hasAgents: false,
        agentCount: 0,
        hasCommands: false,
        commandCount: 0,
      });
      vi.mocked(clack.text).mockResolvedValueOnce("my-captured");

      await initFlow({
        installDir: "/test/dir",
        callbacks: mockCallbacks,
      });

      expect(mockCallbacks.onCaptureConfig).toHaveBeenCalledWith({
        installDir: "/test/dir",
        profileName: "my-captured",
      });
    });

    it("should call onInit with captured profile name", async () => {
      vi.mocked(clack.confirm).mockResolvedValueOnce(true);
      vi.mocked(mockCallbacks.onDetectExistingConfig).mockResolvedValueOnce({
        hasClaudeMd: true,
        hasManagedBlock: false,
        hasSkills: false,
        skillCount: 0,
        hasAgents: false,
        agentCount: 0,
        hasCommands: false,
        commandCount: 0,
      });
      vi.mocked(clack.text).mockResolvedValueOnce("my-captured");

      await initFlow({
        installDir: "/test/dir",
        callbacks: mockCallbacks,
      });

      expect(mockCallbacks.onInit).toHaveBeenCalledWith({
        installDir: "/test/dir",
        capturedProfileName: "my-captured",
      });
    });

    it("should return result with captured profile name", async () => {
      vi.mocked(clack.confirm).mockResolvedValueOnce(true);
      vi.mocked(mockCallbacks.onDetectExistingConfig).mockResolvedValueOnce({
        hasClaudeMd: true,
        hasManagedBlock: false,
        hasSkills: false,
        skillCount: 0,
        hasAgents: false,
        agentCount: 0,
        hasCommands: false,
        commandCount: 0,
      });
      vi.mocked(clack.text).mockResolvedValueOnce("my-captured");

      const result = await initFlow({
        installDir: "/test/dir",
        callbacks: mockCallbacks,
      });

      expect(result).toEqual({ capturedProfileName: "my-captured" });
    });
  });

  describe("ancestor installations warning", () => {
    it("should still proceed with init after ancestor warning", async () => {
      vi.mocked(clack.confirm).mockResolvedValueOnce(true);
      vi.mocked(mockCallbacks.onCheckAncestors).mockResolvedValueOnce([
        "/home/user/project",
      ]);

      await initFlow({
        installDir: "/test/dir",
        callbacks: mockCallbacks,
      });

      // Init should still be called despite ancestor warning
      expect(mockCallbacks.onInit).toHaveBeenCalled();
    });
  });

  describe("user declines persistence warning", () => {
    it("should return null when user declines confirm", async () => {
      vi.mocked(clack.confirm).mockResolvedValueOnce(false);

      const result = await initFlow({
        installDir: "/test/dir",
        callbacks: mockCallbacks,
      });

      expect(result).toBeNull();
    });

    it("should not call onInit when user declines", async () => {
      vi.mocked(clack.confirm).mockResolvedValueOnce(false);

      await initFlow({
        installDir: "/test/dir",
        callbacks: mockCallbacks,
      });

      expect(mockCallbacks.onInit).not.toHaveBeenCalled();
    });

    it("should not call onDetectExistingConfig when user declines", async () => {
      vi.mocked(clack.confirm).mockResolvedValueOnce(false);

      await initFlow({
        installDir: "/test/dir",
        callbacks: mockCallbacks,
      });

      expect(mockCallbacks.onDetectExistingConfig).not.toHaveBeenCalled();
    });
  });

  describe("cancellation", () => {
    it("should return null when user cancels at persistence confirm", async () => {
      const cancelSymbol = Symbol.for("cancel");
      vi.mocked(clack.confirm).mockResolvedValueOnce(cancelSymbol as any);
      vi.mocked(clack.isCancel).mockImplementation(
        (value) => value === cancelSymbol,
      );

      const result = await initFlow({
        installDir: "/test/dir",
        callbacks: mockCallbacks,
      });

      expect(result).toBeNull();
      expect(mockCallbacks.onInit).not.toHaveBeenCalled();
    });

    it("should return null when user cancels at profile name prompt", async () => {
      vi.mocked(clack.confirm).mockResolvedValueOnce(true);
      vi.mocked(mockCallbacks.onDetectExistingConfig).mockResolvedValueOnce({
        hasClaudeMd: true,
        hasManagedBlock: false,
        hasSkills: false,
        skillCount: 0,
        hasAgents: false,
        agentCount: 0,
        hasCommands: false,
        commandCount: 0,
      });
      const cancelSymbol = Symbol.for("cancel");
      vi.mocked(clack.text).mockResolvedValueOnce(cancelSymbol as any);
      vi.mocked(clack.isCancel).mockImplementation(
        (value) => value === cancelSymbol,
      );

      const result = await initFlow({
        installDir: "/test/dir",
        callbacks: mockCallbacks,
      });

      expect(result).toBeNull();
      expect(mockCallbacks.onCaptureConfig).not.toHaveBeenCalled();
      expect(mockCallbacks.onInit).not.toHaveBeenCalled();
    });
  });

  describe("skipWarning parameter", () => {
    it("should skip confirm prompt when skipWarning is true", async () => {
      await initFlow({
        installDir: "/test/dir",
        skipWarning: true,
        callbacks: mockCallbacks,
      });

      expect(clack.confirm).not.toHaveBeenCalled();
    });

    it("should still call onInit when skipWarning is true", async () => {
      await initFlow({
        installDir: "/test/dir",
        skipWarning: true,
        callbacks: mockCallbacks,
      });

      expect(mockCallbacks.onInit).toHaveBeenCalled();
    });
  });

  describe("skipIntro parameter", () => {
    it("should skip intro when skipIntro is true", async () => {
      vi.mocked(clack.confirm).mockResolvedValueOnce(true);

      await initFlow({
        installDir: "/test/dir",
        skipIntro: true,
        callbacks: mockCallbacks,
      });

      expect(clack.intro).not.toHaveBeenCalled();
    });

    it("should show intro by default", async () => {
      vi.mocked(clack.confirm).mockResolvedValueOnce(true);

      await initFlow({
        installDir: "/test/dir",
        callbacks: mockCallbacks,
      });

      expect(clack.intro).toHaveBeenCalled();
    });
  });
});
