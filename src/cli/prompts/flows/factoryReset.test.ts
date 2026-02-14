/**
 * Tests for factory reset flow module
 *
 * These tests verify the factoryResetFlow function behavior including:
 * - Happy path: artifacts found, user confirms, deletion executed
 * - No artifacts: early exit with info message
 * - User types something other than "confirm": no deletion
 * - User cancels (Ctrl+C) at text prompt: returns null
 * - Agent name appears in intro
 */

import * as clack from "@clack/prompts";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  factoryResetFlow,
  type FactoryResetFlowCallbacks,
} from "./factoryReset.js";

vi.mock("@clack/prompts", () => ({
  intro: vi.fn(),
  outro: vi.fn(),
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

describe("factoryResetFlow", () => {
  let mockCallbacks: FactoryResetFlowCallbacks;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(clack.isCancel).mockReturnValue(false);

    mockCallbacks = {
      onFindArtifacts: vi.fn().mockResolvedValue({ artifacts: [] }),
      onDeleteArtifacts: vi.fn().mockResolvedValue(undefined),
    };
  });

  describe("happy path: artifacts found and user confirms", () => {
    it("should call onFindArtifacts with the provided path", async () => {
      vi.mocked(mockCallbacks.onFindArtifacts).mockResolvedValueOnce({
        artifacts: [{ path: "/test/.claude", type: "directory" }],
      });
      vi.mocked(clack.text).mockResolvedValueOnce("confirm");

      await factoryResetFlow({
        agentName: "Claude Code",
        path: "/test",
        callbacks: mockCallbacks,
      });

      expect(mockCallbacks.onFindArtifacts).toHaveBeenCalledWith({
        path: "/test",
      });
    });

    it("should display artifacts in a note before prompting", async () => {
      vi.mocked(mockCallbacks.onFindArtifacts).mockResolvedValueOnce({
        artifacts: [
          { path: "/test/.claude", type: "directory" },
          { path: "/test/CLAUDE.md", type: "file" },
        ],
      });
      vi.mocked(clack.text).mockResolvedValueOnce("confirm");

      await factoryResetFlow({
        agentName: "Claude Code",
        path: "/test",
        callbacks: mockCallbacks,
      });

      expect(clack.note).toHaveBeenCalledTimes(1);
      const noteContent = vi.mocked(clack.note).mock.calls[0][0];
      expect(noteContent).toContain("/test/.claude");
      expect(noteContent).toContain("/test/CLAUDE.md");
    });

    it("should call onDeleteArtifacts with the found artifacts", async () => {
      const artifacts = [
        { path: "/test/.claude", type: "directory" as const },
        { path: "/test/CLAUDE.md", type: "file" as const },
      ];
      vi.mocked(mockCallbacks.onFindArtifacts).mockResolvedValueOnce({
        artifacts,
      });
      vi.mocked(clack.text).mockResolvedValueOnce("confirm");

      await factoryResetFlow({
        agentName: "Claude Code",
        path: "/test",
        callbacks: mockCallbacks,
      });

      expect(mockCallbacks.onDeleteArtifacts).toHaveBeenCalledWith({
        artifacts,
      });
    });

    it("should return result with deletedCount matching artifact count", async () => {
      vi.mocked(mockCallbacks.onFindArtifacts).mockResolvedValueOnce({
        artifacts: [
          { path: "/test/.claude", type: "directory" },
          { path: "/test/CLAUDE.md", type: "file" },
        ],
      });
      vi.mocked(clack.text).mockResolvedValueOnce("confirm");

      const result = await factoryResetFlow({
        agentName: "Claude Code",
        path: "/test",
        callbacks: mockCallbacks,
      });

      expect(result).toEqual({ deletedCount: 2 });
    });

    it("should call outro with completion message", async () => {
      vi.mocked(mockCallbacks.onFindArtifacts).mockResolvedValueOnce({
        artifacts: [{ path: "/test/.claude", type: "directory" }],
      });
      vi.mocked(clack.text).mockResolvedValueOnce("confirm");

      await factoryResetFlow({
        agentName: "Claude Code",
        path: "/test",
        callbacks: mockCallbacks,
      });

      expect(clack.outro).toHaveBeenCalledTimes(1);
    });
  });

  describe("no artifacts found", () => {
    it("should return result with deletedCount 0", async () => {
      const result = await factoryResetFlow({
        agentName: "Claude Code",
        path: "/test",
        callbacks: mockCallbacks,
      });

      expect(result).toEqual({ deletedCount: 0 });
    });

    it("should display info message about no configuration found", async () => {
      await factoryResetFlow({
        agentName: "Claude Code",
        path: "/test",
        callbacks: mockCallbacks,
      });

      expect(clack.log.info).toHaveBeenCalledWith(
        expect.stringContaining("No"),
      );
    });

    it("should not call onDeleteArtifacts", async () => {
      await factoryResetFlow({
        agentName: "Claude Code",
        path: "/test",
        callbacks: mockCallbacks,
      });

      expect(mockCallbacks.onDeleteArtifacts).not.toHaveBeenCalled();
    });

    it("should not show text prompt", async () => {
      await factoryResetFlow({
        agentName: "Claude Code",
        path: "/test",
        callbacks: mockCallbacks,
      });

      expect(clack.text).not.toHaveBeenCalled();
    });
  });

  describe("user does not type confirm", () => {
    it("should return null when user types something other than confirm", async () => {
      vi.mocked(mockCallbacks.onFindArtifacts).mockResolvedValueOnce({
        artifacts: [{ path: "/test/.claude", type: "directory" }],
      });
      vi.mocked(clack.text).mockResolvedValueOnce("no");

      const result = await factoryResetFlow({
        agentName: "Claude Code",
        path: "/test",
        callbacks: mockCallbacks,
      });

      expect(result).toBeNull();
    });

    it("should not call onDeleteArtifacts when user declines", async () => {
      vi.mocked(mockCallbacks.onFindArtifacts).mockResolvedValueOnce({
        artifacts: [{ path: "/test/.claude", type: "directory" }],
      });
      vi.mocked(clack.text).mockResolvedValueOnce("no");

      await factoryResetFlow({
        agentName: "Claude Code",
        path: "/test",
        callbacks: mockCallbacks,
      });

      expect(mockCallbacks.onDeleteArtifacts).not.toHaveBeenCalled();
    });
  });

  describe("user cancels at text prompt", () => {
    it("should return null when user cancels", async () => {
      vi.mocked(mockCallbacks.onFindArtifacts).mockResolvedValueOnce({
        artifacts: [{ path: "/test/.claude", type: "directory" }],
      });
      const cancelSymbol = Symbol.for("cancel");
      vi.mocked(clack.text).mockResolvedValueOnce(cancelSymbol as any);
      vi.mocked(clack.isCancel).mockImplementation(
        (value) => value === cancelSymbol,
      );

      const result = await factoryResetFlow({
        agentName: "Claude Code",
        path: "/test",
        callbacks: mockCallbacks,
      });

      expect(result).toBeNull();
    });

    it("should not call onDeleteArtifacts when user cancels", async () => {
      vi.mocked(mockCallbacks.onFindArtifacts).mockResolvedValueOnce({
        artifacts: [{ path: "/test/.claude", type: "directory" }],
      });
      const cancelSymbol = Symbol.for("cancel");
      vi.mocked(clack.text).mockResolvedValueOnce(cancelSymbol as any);
      vi.mocked(clack.isCancel).mockImplementation(
        (value) => value === cancelSymbol,
      );

      await factoryResetFlow({
        agentName: "Claude Code",
        path: "/test",
        callbacks: mockCallbacks,
      });

      expect(mockCallbacks.onDeleteArtifacts).not.toHaveBeenCalled();
    });
  });

  describe("intro displays agent name", () => {
    it("should include agent name in intro message", async () => {
      await factoryResetFlow({
        agentName: "Claude Code",
        path: "/test",
        callbacks: mockCallbacks,
      });

      expect(clack.intro).toHaveBeenCalledWith(
        expect.stringContaining("Claude Code"),
      );
    });
  });
});
