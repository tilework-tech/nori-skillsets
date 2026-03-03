/**
 * Tests for init flow module
 *
 * These tests verify the initFlow function behavior including:
 * - Happy path: callbacks invoked correctly, result returned
 * - Existing config: skillset name collected, capture callback invoked
 * - Ancestor warnings don't block init
 * - Decline/cancel at each prompt returns null without side effects
 * - skipWarning parameter behavior
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

    it("should call onInit with install dir and null skillset name", async () => {
      vi.mocked(clack.confirm).mockResolvedValueOnce(true);

      await initFlow({
        installDir: "/test/dir",
        callbacks: mockCallbacks,
      });

      expect(mockCallbacks.onInit).toHaveBeenCalledWith({
        installDir: "/test/dir",
        capturedSkillsetName: null,
      });
    });

    it("should return result with null capturedSkillsetName and statusMessage", async () => {
      vi.mocked(clack.confirm).mockResolvedValueOnce(true);

      const result = await initFlow({
        installDir: "/test/dir",
        callbacks: mockCallbacks,
      });

      expect(result?.capturedSkillsetName).toBeNull();
      expect(result?.statusMessage).toContain("Nori initialized successfully");
    });
  });

  describe("happy path: existing config detected", () => {
    it("should prompt for skillset name with text input", async () => {
      vi.mocked(clack.confirm).mockResolvedValueOnce(true);
      vi.mocked(mockCallbacks.onDetectExistingConfig).mockResolvedValueOnce({
        configFileName: "CLAUDE.md",
        hasConfigFile: true,
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

    it("should call onCaptureConfig with install dir and skillset name", async () => {
      vi.mocked(clack.confirm).mockResolvedValueOnce(true);
      vi.mocked(mockCallbacks.onDetectExistingConfig).mockResolvedValueOnce({
        configFileName: "CLAUDE.md",
        hasConfigFile: true,
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
        skillsetName: "my-captured",
      });
    });

    it("should call onInit with captured skillset name", async () => {
      vi.mocked(clack.confirm).mockResolvedValueOnce(true);
      vi.mocked(mockCallbacks.onDetectExistingConfig).mockResolvedValueOnce({
        configFileName: "CLAUDE.md",
        hasConfigFile: true,
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
        capturedSkillsetName: "my-captured",
      });
    });

    it("should return result with captured skillset name and statusMessage", async () => {
      vi.mocked(clack.confirm).mockResolvedValueOnce(true);
      vi.mocked(mockCallbacks.onDetectExistingConfig).mockResolvedValueOnce({
        configFileName: "CLAUDE.md",
        hasConfigFile: true,
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

      expect(result?.capturedSkillsetName).toBe("my-captured");
      expect(result?.statusMessage).toContain("Nori initialized successfully");
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

    it("should display ancestor warning as a note with Warning title", async () => {
      vi.mocked(clack.confirm).mockResolvedValueOnce(true);
      vi.mocked(mockCallbacks.onCheckAncestors).mockResolvedValueOnce([
        "/home/user/project",
      ]);

      await initFlow({
        installDir: "/test/dir",
        callbacks: mockCallbacks,
      });

      expect(clack.note).toHaveBeenCalledWith(
        expect.stringContaining("ancestor directory"),
        "Warning",
      );
      expect(clack.note).toHaveBeenCalledWith(
        expect.stringContaining("/home/user/project"),
        "Warning",
      );
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

    it("should return null when user cancels at skillset name prompt", async () => {
      vi.mocked(clack.confirm).mockResolvedValueOnce(true);
      vi.mocked(mockCallbacks.onDetectExistingConfig).mockResolvedValueOnce({
        configFileName: "CLAUDE.md",
        hasConfigFile: true,
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

  describe("agent-agnostic display strings", () => {
    it("should display the config file name from ExistingConfig in the summary note", async () => {
      vi.mocked(clack.confirm).mockResolvedValueOnce(true);
      vi.mocked(mockCallbacks.onDetectExistingConfig).mockResolvedValueOnce({
        configFileName: "AGENTS.md",
        hasConfigFile: true,
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

      // The note should mention "AGENTS.md", not hardcoded "CLAUDE.md"
      expect(clack.note).toHaveBeenCalledWith(
        expect.stringContaining("AGENTS.md found"),
        "Existing Configuration Detected",
      );
    });

    it("should display managed block message using the config file name from ExistingConfig", async () => {
      vi.mocked(clack.confirm).mockResolvedValueOnce(true);
      vi.mocked(mockCallbacks.onDetectExistingConfig).mockResolvedValueOnce({
        configFileName: "AGENTS.md",
        hasConfigFile: true,
        hasManagedBlock: true,
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

      expect(clack.note).toHaveBeenCalledWith(
        expect.stringContaining("Your AGENTS.md contains"),
        "Existing Configuration Detected",
      );
    });

    it("should not contain hardcoded 'Claude Code' or 'CLAUDE.md' in ancestor warning text", async () => {
      vi.mocked(clack.confirm).mockResolvedValueOnce(true);
      vi.mocked(mockCallbacks.onCheckAncestors).mockResolvedValueOnce([
        "/home/user/project",
      ]);

      await initFlow({
        installDir: "/test/dir",
        callbacks: mockCallbacks,
      });

      const warningCall = vi
        .mocked(clack.note)
        .mock.calls.find((call) => call[1] === "Warning");
      expect(warningCall).toBeDefined();
      const warningText = warningCall![0] as string;
      expect(warningText).not.toContain("Claude Code");
      expect(warningText).not.toContain("CLAUDE.md");
    });
  });

  describe("no intro/outro framing", () => {
    it("should not call intro or outro (top-level caller handles framing)", async () => {
      vi.mocked(clack.confirm).mockResolvedValueOnce(true);

      await initFlow({
        installDir: "/test/dir",
        callbacks: mockCallbacks,
      });

      expect(clack.intro).not.toHaveBeenCalled();
      expect(clack.outro).not.toHaveBeenCalled();
    });
  });
});
