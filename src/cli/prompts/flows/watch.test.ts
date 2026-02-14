/**
 * Tests for watch flow module
 *
 * These tests verify the watchFlow function behavior including:
 * - Happy path: single org auto-selects, daemon starts
 * - Happy path: multiple orgs, user selects one
 * - Already running: shows spinner while stopping existing daemon
 * - Current destination reused when valid and not forcing re-selection
 * - No private orgs: warns and returns null
 * - User cancels org selection
 * - Daemon start failure: logs error, returns null
 */

import * as clack from "@clack/prompts";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { watchFlow, type WatchFlowCallbacks } from "./watch.js";

vi.mock("@clack/prompts", () => ({
  intro: vi.fn(),
  note: vi.fn(),
  outro: vi.fn(),
  select: vi.fn(),
  spinner: vi.fn(() => ({
    start: vi.fn(),
    stop: vi.fn(),
    cancel: vi.fn(),
    error: vi.fn(),
    message: vi.fn(),
    clear: vi.fn(),
    isCancelled: false,
  })),
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

describe("watchFlow", () => {
  let mockCallbacks: WatchFlowCallbacks;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(clack.isCancel).mockReturnValue(false);

    mockCallbacks = {
      onPrepare: vi.fn().mockResolvedValue({
        privateOrgs: ["org-alpha"],
        currentDestination: null,
        isRunning: false,
      }),
      onStartDaemon: vi.fn().mockResolvedValue({
        success: true,
        pid: 12345,
        logFile: "/tmp/watch.log",
        transcriptsDir: "/home/test/.nori/transcripts",
      }),
    };
  });

  describe("happy path: single org", () => {
    it("should auto-select the only org and start daemon", async () => {
      const result = await watchFlow({
        callbacks: mockCallbacks,
      });

      expect(result).toEqual({
        org: "org-alpha",
        pid: 12345,
        logFile: "/tmp/watch.log",
      });
      expect(mockCallbacks.onPrepare).toHaveBeenCalled();
      expect(mockCallbacks.onStartDaemon).toHaveBeenCalledWith({
        org: "org-alpha",
      });
    });

    it("should show intro and outro", async () => {
      await watchFlow({ callbacks: mockCallbacks });

      expect(clack.intro).toHaveBeenCalledWith("nori watch");
      expect(clack.note).toHaveBeenCalledWith(
        expect.stringContaining("12345"),
        "Watch Details",
      );
      expect(clack.outro).toHaveBeenCalledWith("Watching for sessions.");
    });

    it("should not prompt for org selection with single org", async () => {
      await watchFlow({ callbacks: mockCallbacks });

      expect(clack.select).not.toHaveBeenCalled();
    });
  });

  describe("happy path: multiple orgs with selection", () => {
    beforeEach(() => {
      vi.mocked(mockCallbacks.onPrepare).mockResolvedValue({
        privateOrgs: ["org-alpha", "org-beta", "org-gamma"],
        currentDestination: null,
        isRunning: false,
      });
      vi.mocked(clack.select).mockResolvedValue("org-beta");
    });

    it("should prompt user when multiple orgs and no current destination", async () => {
      const result = await watchFlow({
        callbacks: mockCallbacks,
      });

      expect(clack.select).toHaveBeenCalled();
      expect(result).toEqual({
        org: "org-beta",
        pid: 12345,
        logFile: "/tmp/watch.log",
      });
      expect(mockCallbacks.onStartDaemon).toHaveBeenCalledWith({
        org: "org-beta",
      });
    });

    it("should prompt user when forceSelection is true even with valid destination", async () => {
      vi.mocked(mockCallbacks.onPrepare).mockResolvedValue({
        privateOrgs: ["org-alpha", "org-beta"],
        currentDestination: "org-alpha",
        isRunning: false,
      });
      vi.mocked(clack.select).mockResolvedValue("org-beta");

      const result = await watchFlow({
        forceSelection: true,
        callbacks: mockCallbacks,
      });

      expect(clack.select).toHaveBeenCalled();
      expect(result).toEqual({
        org: "org-beta",
        pid: 12345,
        logFile: "/tmp/watch.log",
      });
    });
  });

  describe("current destination reuse", () => {
    it("should reuse current destination when valid and not forcing", async () => {
      vi.mocked(mockCallbacks.onPrepare).mockResolvedValue({
        privateOrgs: ["org-alpha", "org-beta"],
        currentDestination: "org-beta",
        isRunning: false,
      });

      const result = await watchFlow({
        callbacks: mockCallbacks,
      });

      expect(clack.select).not.toHaveBeenCalled();
      expect(result).toEqual({
        org: "org-beta",
        pid: 12345,
        logFile: "/tmp/watch.log",
      });
    });

    it("should prompt when current destination not in org list", async () => {
      vi.mocked(mockCallbacks.onPrepare).mockResolvedValue({
        privateOrgs: ["org-alpha", "org-beta"],
        currentDestination: "org-deleted",
        isRunning: false,
      });
      vi.mocked(clack.select).mockResolvedValue("org-alpha");

      const result = await watchFlow({
        callbacks: mockCallbacks,
      });

      expect(clack.select).toHaveBeenCalled();
      expect(result).toEqual({
        org: "org-alpha",
        pid: 12345,
        logFile: "/tmp/watch.log",
      });
    });
  });

  describe("already running", () => {
    it("should show stopping message via spinner when daemon is running", async () => {
      const mockSpinner = {
        start: vi.fn(),
        stop: vi.fn(),
        cancel: vi.fn(),
        error: vi.fn(),
        message: vi.fn(),
        clear: vi.fn(),
        isCancelled: false,
      };
      vi.mocked(clack.spinner).mockReturnValue(mockSpinner);

      vi.mocked(mockCallbacks.onPrepare).mockResolvedValue({
        privateOrgs: ["org-alpha"],
        currentDestination: null,
        isRunning: true,
      });

      await watchFlow({ callbacks: mockCallbacks });

      expect(mockSpinner.start).toHaveBeenCalledWith("Preparing...");
      expect(mockSpinner.stop).toHaveBeenCalledWith(
        "Stopped existing watch daemon.",
      );
    });
  });

  describe("no private orgs", () => {
    it("should warn and return null when no private orgs available", async () => {
      vi.mocked(mockCallbacks.onPrepare).mockResolvedValue({
        privateOrgs: [],
        currentDestination: null,
        isRunning: false,
      });

      const result = await watchFlow({
        callbacks: mockCallbacks,
      });

      expect(result).toBeNull();
      expect(clack.log.warn).toHaveBeenCalledWith(
        expect.stringContaining("No private organizations"),
      );
      expect(clack.outro).toHaveBeenCalledWith("Watch cancelled.");
      expect(mockCallbacks.onStartDaemon).not.toHaveBeenCalled();
    });
  });

  describe("cancellation", () => {
    it("should return null when user cancels org selection", async () => {
      vi.mocked(mockCallbacks.onPrepare).mockResolvedValue({
        privateOrgs: ["org-alpha", "org-beta"],
        currentDestination: null,
        isRunning: false,
      });

      const cancelSymbol = Symbol.for("cancel");
      vi.mocked(clack.select).mockResolvedValue(cancelSymbol);
      vi.mocked(clack.isCancel).mockImplementation(
        (value) => value === cancelSymbol,
      );

      const result = await watchFlow({
        callbacks: mockCallbacks,
      });

      expect(result).toBeNull();
      expect(mockCallbacks.onStartDaemon).not.toHaveBeenCalled();
    });
  });

  describe("daemon start failure", () => {
    it("should log error and return null when daemon fails to start", async () => {
      vi.mocked(mockCallbacks.onStartDaemon).mockResolvedValue({
        success: false,
        error: "Failed to spawn daemon process",
      });

      const result = await watchFlow({
        callbacks: mockCallbacks,
      });

      expect(result).toBeNull();
      expect(clack.log.error).toHaveBeenCalledWith(
        expect.stringContaining("Failed to spawn daemon process"),
      );
      expect(clack.outro).toHaveBeenCalledWith("Watch failed.");
    });
  });
});
