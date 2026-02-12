/**
 * Tests for switch-skillset flow module
 *
 * These tests verify the switchSkillsetFlow function behavior including:
 * - Happy path: single agent, no changes, user confirms
 * - Agent selection when multiple agents installed
 * - Local change detection and handling (proceed, capture, abort)
 * - Confirmation and cancellation at various flow stages
 * - Zero agents edge case (defaults to claude-code)
 */

import * as clack from "@clack/prompts";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  switchSkillsetFlow,
  type SwitchSkillsetCallbacks,
} from "./switchSkillset.js";

vi.mock("@clack/prompts", () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  select: vi.fn(),
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

describe("switchSkillsetFlow", () => {
  let mockCallbacks: SwitchSkillsetCallbacks;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(clack.isCancel).mockReturnValue(false);

    mockCallbacks = {
      onResolveAgents: vi
        .fn()
        .mockResolvedValue([
          { name: "claude-code", displayName: "Claude Code" },
        ]),
      onPrepareSwitchInfo: vi.fn().mockResolvedValue({
        currentProfile: "senior-swe",
        localChanges: null,
      }),
      onCaptureConfig: vi.fn().mockResolvedValue(undefined),
      onExecuteSwitch: vi.fn().mockResolvedValue(undefined),
    };
  });

  describe("happy path: single agent, no changes, user confirms", () => {
    it("should not show agent select when single agent", async () => {
      vi.mocked(clack.confirm).mockResolvedValueOnce(true);

      await switchSkillsetFlow({
        profileName: "product-manager",
        installDir: "/test/dir",
        callbacks: mockCallbacks,
      });

      expect(clack.select).not.toHaveBeenCalled();
    });

    it("should show confirmation with current and new skillset info", async () => {
      vi.mocked(clack.confirm).mockResolvedValueOnce(true);

      await switchSkillsetFlow({
        profileName: "product-manager",
        installDir: "/test/dir",
        callbacks: mockCallbacks,
      });

      expect(clack.confirm).toHaveBeenCalledTimes(1);
      const confirmCall = vi.mocked(clack.confirm).mock.calls[0][0];
      expect(confirmCall.message).toContain("product-manager");
    });

    it("should display note with switch details before confirmation", async () => {
      vi.mocked(clack.confirm).mockResolvedValueOnce(true);

      await switchSkillsetFlow({
        profileName: "product-manager",
        installDir: "/test/dir",
        callbacks: mockCallbacks,
      });

      // note should show install dir, agent, current skillset, new skillset
      expect(clack.note).toHaveBeenCalledWith(
        expect.stringContaining("product-manager"),
        expect.any(String),
      );
      expect(clack.note).toHaveBeenCalledWith(
        expect.stringContaining("senior-swe"),
        expect.any(String),
      );
    });

    it("should call onExecuteSwitch when confirmed", async () => {
      vi.mocked(clack.confirm).mockResolvedValueOnce(true);

      await switchSkillsetFlow({
        profileName: "product-manager",
        installDir: "/test/dir",
        callbacks: mockCallbacks,
      });

      expect(mockCallbacks.onExecuteSwitch).toHaveBeenCalledWith({
        installDir: "/test/dir",
        agentName: "claude-code",
        profileName: "product-manager",
      });
    });

    it("should return result with agent and profile name", async () => {
      vi.mocked(clack.confirm).mockResolvedValueOnce(true);

      const result = await switchSkillsetFlow({
        profileName: "product-manager",
        installDir: "/test/dir",
        callbacks: mockCallbacks,
      });

      expect(result).toEqual({
        agentName: "claude-code",
        profileName: "product-manager",
      });
    });
  });

  describe("agent override", () => {
    it("should skip agent selection and use override when provided", async () => {
      vi.mocked(clack.confirm).mockResolvedValueOnce(true);

      const result = await switchSkillsetFlow({
        profileName: "product-manager",
        installDir: "/test/dir",
        agentOverride: "cursor-agent",
        callbacks: mockCallbacks,
      });

      expect(mockCallbacks.onResolveAgents).not.toHaveBeenCalled();
      expect(clack.select).not.toHaveBeenCalled();
      expect(mockCallbacks.onExecuteSwitch).toHaveBeenCalledWith(
        expect.objectContaining({ agentName: "cursor-agent" }),
      );
      expect(result).toEqual({
        agentName: "cursor-agent",
        profileName: "product-manager",
      });
    });
  });

  describe("multiple agents", () => {
    it("should show agent select when multiple agents installed", async () => {
      vi.mocked(mockCallbacks.onResolveAgents).mockResolvedValueOnce([
        { name: "claude-code", displayName: "Claude Code" },
        { name: "cursor-agent", displayName: "Cursor" },
      ]);
      vi.mocked(clack.select).mockResolvedValueOnce("cursor-agent");
      vi.mocked(clack.confirm).mockResolvedValueOnce(true);

      await switchSkillsetFlow({
        profileName: "product-manager",
        installDir: "/test/dir",
        callbacks: mockCallbacks,
      });

      expect(clack.select).toHaveBeenCalledTimes(1);
      const selectCall = vi.mocked(clack.select).mock.calls[0][0];
      expect(selectCall.options).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            value: "claude-code",
            label: expect.stringContaining("Claude Code"),
          }),
          expect.objectContaining({
            value: "cursor-agent",
            label: expect.stringContaining("Cursor"),
          }),
        ]),
      );
    });

    it("should use selected agent for subsequent operations", async () => {
      vi.mocked(mockCallbacks.onResolveAgents).mockResolvedValueOnce([
        { name: "claude-code", displayName: "Claude Code" },
        { name: "cursor-agent", displayName: "Cursor" },
      ]);
      vi.mocked(clack.select).mockResolvedValueOnce("cursor-agent");
      vi.mocked(clack.confirm).mockResolvedValueOnce(true);

      await switchSkillsetFlow({
        profileName: "product-manager",
        installDir: "/test/dir",
        callbacks: mockCallbacks,
      });

      expect(mockCallbacks.onExecuteSwitch).toHaveBeenCalledWith(
        expect.objectContaining({ agentName: "cursor-agent" }),
      );
    });
  });

  describe("local changes detected - proceed", () => {
    it("should show note with changed files when changes detected", async () => {
      vi.mocked(mockCallbacks.onPrepareSwitchInfo).mockResolvedValueOnce({
        currentProfile: "senior-swe",
        localChanges: {
          modified: ["skills/my-skill/SKILL.md"],
          added: ["skills/new-skill/SKILL.md"],
          deleted: [],
        },
      });
      // First select: change handling (proceed)
      vi.mocked(clack.select).mockResolvedValueOnce("proceed");
      vi.mocked(clack.confirm).mockResolvedValueOnce(true);

      await switchSkillsetFlow({
        profileName: "product-manager",
        installDir: "/test/dir",
        callbacks: mockCallbacks,
      });

      // Should show note about changed files
      expect(clack.note).toHaveBeenCalledWith(
        expect.stringContaining("Modified"),
        expect.any(String),
      );
    });

    it("should show select with proceed/capture/abort options", async () => {
      vi.mocked(mockCallbacks.onPrepareSwitchInfo).mockResolvedValueOnce({
        currentProfile: "senior-swe",
        localChanges: {
          modified: ["skills/my-skill/SKILL.md"],
          added: [],
          deleted: [],
        },
      });
      vi.mocked(clack.select).mockResolvedValueOnce("proceed");
      vi.mocked(clack.confirm).mockResolvedValueOnce(true);

      await switchSkillsetFlow({
        profileName: "product-manager",
        installDir: "/test/dir",
        callbacks: mockCallbacks,
      });

      const selectCall = vi.mocked(clack.select).mock.calls[0][0];
      expect(selectCall.options).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ value: "proceed" }),
          expect.objectContaining({ value: "capture" }),
          expect.objectContaining({ value: "abort" }),
        ]),
      );
    });

    it("should continue to confirmation after selecting proceed", async () => {
      vi.mocked(mockCallbacks.onPrepareSwitchInfo).mockResolvedValueOnce({
        currentProfile: "senior-swe",
        localChanges: {
          modified: ["skills/my-skill/SKILL.md"],
          added: [],
          deleted: [],
        },
      });
      vi.mocked(clack.select).mockResolvedValueOnce("proceed");
      vi.mocked(clack.confirm).mockResolvedValueOnce(true);

      await switchSkillsetFlow({
        profileName: "product-manager",
        installDir: "/test/dir",
        callbacks: mockCallbacks,
      });

      expect(clack.confirm).toHaveBeenCalledTimes(1);
      expect(mockCallbacks.onExecuteSwitch).toHaveBeenCalled();
    });
  });

  describe("local changes detected - capture", () => {
    it("should prompt for skillset name when capture selected", async () => {
      vi.mocked(mockCallbacks.onPrepareSwitchInfo).mockResolvedValueOnce({
        currentProfile: "senior-swe",
        localChanges: {
          modified: ["skills/my-skill/SKILL.md"],
          added: [],
          deleted: [],
        },
      });
      vi.mocked(clack.select).mockResolvedValueOnce("capture");
      vi.mocked(clack.text).mockResolvedValueOnce("my-custom-skillset");
      vi.mocked(clack.confirm).mockResolvedValueOnce(true);

      await switchSkillsetFlow({
        profileName: "product-manager",
        installDir: "/test/dir",
        callbacks: mockCallbacks,
      });

      expect(clack.text).toHaveBeenCalledTimes(1);
      const textCall = vi.mocked(clack.text).mock.calls[0][0];
      expect(textCall.validate).toBeDefined();
    });

    it("should call onCaptureConfig with entered name", async () => {
      vi.mocked(mockCallbacks.onPrepareSwitchInfo).mockResolvedValueOnce({
        currentProfile: "senior-swe",
        localChanges: {
          modified: ["skills/my-skill/SKILL.md"],
          added: [],
          deleted: [],
        },
      });
      vi.mocked(clack.select).mockResolvedValueOnce("capture");
      vi.mocked(clack.text).mockResolvedValueOnce("my-custom-skillset");
      vi.mocked(clack.confirm).mockResolvedValueOnce(true);

      await switchSkillsetFlow({
        profileName: "product-manager",
        installDir: "/test/dir",
        callbacks: mockCallbacks,
      });

      expect(mockCallbacks.onCaptureConfig).toHaveBeenCalledWith({
        installDir: "/test/dir",
        profileName: "my-custom-skillset",
      });
    });

    it("should continue to confirmation after capture", async () => {
      vi.mocked(mockCallbacks.onPrepareSwitchInfo).mockResolvedValueOnce({
        currentProfile: "senior-swe",
        localChanges: {
          modified: ["skills/my-skill/SKILL.md"],
          added: [],
          deleted: [],
        },
      });
      vi.mocked(clack.select).mockResolvedValueOnce("capture");
      vi.mocked(clack.text).mockResolvedValueOnce("my-custom-skillset");
      vi.mocked(clack.confirm).mockResolvedValueOnce(true);

      await switchSkillsetFlow({
        profileName: "product-manager",
        installDir: "/test/dir",
        callbacks: mockCallbacks,
      });

      expect(clack.confirm).toHaveBeenCalledTimes(1);
      expect(mockCallbacks.onExecuteSwitch).toHaveBeenCalled();
    });
  });

  describe("local changes detected - abort", () => {
    it("should return null when user selects abort", async () => {
      vi.mocked(mockCallbacks.onPrepareSwitchInfo).mockResolvedValueOnce({
        currentProfile: "senior-swe",
        localChanges: {
          modified: ["skills/my-skill/SKILL.md"],
          added: [],
          deleted: [],
        },
      });
      vi.mocked(clack.select).mockResolvedValueOnce("abort");

      const result = await switchSkillsetFlow({
        profileName: "product-manager",
        installDir: "/test/dir",
        callbacks: mockCallbacks,
      });

      expect(result).toBeNull();
    });

    it("should not call onExecuteSwitch when user aborts", async () => {
      vi.mocked(mockCallbacks.onPrepareSwitchInfo).mockResolvedValueOnce({
        currentProfile: "senior-swe",
        localChanges: {
          modified: ["skills/my-skill/SKILL.md"],
          added: [],
          deleted: [],
        },
      });
      vi.mocked(clack.select).mockResolvedValueOnce("abort");

      await switchSkillsetFlow({
        profileName: "product-manager",
        installDir: "/test/dir",
        callbacks: mockCallbacks,
      });

      expect(mockCallbacks.onExecuteSwitch).not.toHaveBeenCalled();
      expect(clack.confirm).not.toHaveBeenCalled();
    });
  });

  describe("user declines confirmation", () => {
    it("should return null when user declines", async () => {
      vi.mocked(clack.confirm).mockResolvedValueOnce(false);

      const result = await switchSkillsetFlow({
        profileName: "product-manager",
        installDir: "/test/dir",
        callbacks: mockCallbacks,
      });

      expect(result).toBeNull();
    });
  });

  describe("cancellation", () => {
    it("should return null when user cancels at agent select", async () => {
      vi.mocked(mockCallbacks.onResolveAgents).mockResolvedValueOnce([
        { name: "claude-code", displayName: "Claude Code" },
        { name: "cursor-agent", displayName: "Cursor" },
      ]);
      const cancelSymbol = Symbol.for("cancel");
      vi.mocked(clack.select).mockResolvedValueOnce(cancelSymbol as any);
      vi.mocked(clack.isCancel).mockImplementation(
        (value) => value === cancelSymbol,
      );

      const result = await switchSkillsetFlow({
        profileName: "product-manager",
        installDir: "/test/dir",
        callbacks: mockCallbacks,
      });

      expect(result).toBeNull();
      expect(mockCallbacks.onExecuteSwitch).not.toHaveBeenCalled();
    });

    it("should return null when user cancels at confirmation", async () => {
      const cancelSymbol = Symbol.for("cancel");
      vi.mocked(clack.confirm).mockResolvedValueOnce(cancelSymbol as any);
      vi.mocked(clack.isCancel).mockImplementation(
        (value) => value === cancelSymbol,
      );

      const result = await switchSkillsetFlow({
        profileName: "product-manager",
        installDir: "/test/dir",
        callbacks: mockCallbacks,
      });

      expect(result).toBeNull();
      expect(mockCallbacks.onExecuteSwitch).not.toHaveBeenCalled();
    });

    it("should return null when user cancels at change handling select", async () => {
      vi.mocked(mockCallbacks.onPrepareSwitchInfo).mockResolvedValueOnce({
        currentProfile: "senior-swe",
        localChanges: {
          modified: ["skills/my-skill/SKILL.md"],
          added: [],
          deleted: [],
        },
      });
      const cancelSymbol = Symbol.for("cancel");
      vi.mocked(clack.select).mockResolvedValueOnce(cancelSymbol as any);
      vi.mocked(clack.isCancel).mockImplementation(
        (value) => value === cancelSymbol,
      );

      const result = await switchSkillsetFlow({
        profileName: "product-manager",
        installDir: "/test/dir",
        callbacks: mockCallbacks,
      });

      expect(result).toBeNull();
      expect(mockCallbacks.onExecuteSwitch).not.toHaveBeenCalled();
    });
  });

  describe("zero agents", () => {
    it("should default to claude-code when no agents installed", async () => {
      vi.mocked(mockCallbacks.onResolveAgents).mockResolvedValueOnce([]);
      vi.mocked(clack.confirm).mockResolvedValueOnce(true);

      await switchSkillsetFlow({
        profileName: "product-manager",
        installDir: "/test/dir",
        callbacks: mockCallbacks,
      });

      expect(clack.select).not.toHaveBeenCalled();
      expect(mockCallbacks.onExecuteSwitch).toHaveBeenCalledWith(
        expect.objectContaining({ agentName: "claude-code" }),
      );
    });
  });
});
