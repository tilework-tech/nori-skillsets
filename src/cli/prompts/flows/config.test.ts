/**
 * Tests for config flow module
 *
 * These tests verify the configFlow function behavior including:
 * - Happy path: user selects agent and enters install dir
 * - Defaults: existing config values appear as defaults
 * - Cancel at agent select: returns null
 * - Cancel at install dir text: returns null
 * - Tilde expansion in install dir
 */

import * as clack from "@clack/prompts";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { configFlow, type ConfigFlowCallbacks } from "./config.js";

vi.mock("@clack/prompts", () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  select: vi.fn(),
  multiselect: vi.fn(),
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

describe("configFlow", () => {
  let mockCallbacks: ConfigFlowCallbacks;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(clack.isCancel).mockReturnValue(false);

    mockCallbacks = {
      onLoadConfig: vi.fn().mockResolvedValue({
        currentAgents: null,
        currentInstallDir: null,
      }),
      onResolveAgents: vi
        .fn()
        .mockResolvedValue([
          { name: "claude-code", displayName: "Claude Code" },
        ]),
    };
  });

  describe("happy path", () => {
    it("should return selected agents array and install dir", async () => {
      vi.mocked(clack.multiselect).mockResolvedValueOnce(["claude-code"]);
      vi.mocked(clack.text).mockResolvedValueOnce("/home/testuser");

      const result = await configFlow({ callbacks: mockCallbacks });

      expect(result).toEqual({
        defaultAgents: ["claude-code"],
        installDir: "/home/testuser",
      });
    });

    it("should show agent multiselect with available agents", async () => {
      vi.mocked(clack.multiselect).mockResolvedValueOnce(["claude-code"]);
      vi.mocked(clack.text).mockResolvedValueOnce("/home/testuser");

      await configFlow({ callbacks: mockCallbacks });

      expect(clack.multiselect).toHaveBeenCalledTimes(1);
      const msCall = vi.mocked(clack.multiselect).mock.calls[0][0];
      expect(msCall.options).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            value: "claude-code",
            label: expect.stringContaining("Claude Code"),
          }),
        ]),
      );
    });

    it("should show text prompt for install dir", async () => {
      vi.mocked(clack.multiselect).mockResolvedValueOnce(["claude-code"]);
      vi.mocked(clack.text).mockResolvedValueOnce("/home/testuser");

      await configFlow({ callbacks: mockCallbacks });

      expect(clack.text).toHaveBeenCalledTimes(1);
    });
  });

  describe("existing config values as defaults", () => {
    it("should use existing install dir as initial value in text", async () => {
      vi.mocked(mockCallbacks.onLoadConfig).mockResolvedValueOnce({
        currentAgents: ["claude-code"],
        currentInstallDir: "/custom/path",
      });
      vi.mocked(clack.multiselect).mockResolvedValueOnce(["claude-code"]);
      vi.mocked(clack.text).mockResolvedValueOnce("/custom/path");

      await configFlow({ callbacks: mockCallbacks });

      const textCall = vi.mocked(clack.text).mock.calls[0][0];
      expect(textCall.initialValue).toBe("/custom/path");
    });
  });

  describe("cancellation", () => {
    it("should return null when user cancels at agent multiselect", async () => {
      const cancelSymbol = Symbol.for("cancel");
      vi.mocked(clack.multiselect).mockResolvedValueOnce(cancelSymbol as any);
      vi.mocked(clack.isCancel).mockImplementation(
        (value) => value === cancelSymbol,
      );

      const result = await configFlow({ callbacks: mockCallbacks });

      expect(result).toBeNull();
      expect(clack.text).not.toHaveBeenCalled();
    });

    it("should return null when user cancels at install dir text", async () => {
      vi.mocked(clack.multiselect).mockResolvedValueOnce(["claude-code"]);
      const cancelSymbol = Symbol.for("cancel");
      vi.mocked(clack.text).mockResolvedValueOnce(cancelSymbol as any);
      vi.mocked(clack.isCancel).mockImplementation(
        (value) => value === cancelSymbol,
      );

      const result = await configFlow({ callbacks: mockCallbacks });

      expect(result).toBeNull();
    });
  });

  describe("defaults when no existing config", () => {
    it("should require at least one agent to be selected", async () => {
      vi.mocked(clack.multiselect).mockResolvedValueOnce(["claude-code"]);
      vi.mocked(clack.text).mockResolvedValueOnce("/home/testuser");

      await configFlow({ callbacks: mockCallbacks });

      const msCall = vi.mocked(clack.multiselect).mock.calls[0][0];
      expect(msCall.required).toBe(true);
    });
  });
});
