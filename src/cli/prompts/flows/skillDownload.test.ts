/**
 * Tests for skill download flow module
 *
 * These tests verify the skillDownloadFlow function behavior including:
 * - Happy path: new download and update
 * - Already-current: user prompted to re-download
 * - Already-current: user declines re-download
 * - Already-current: user cancels at prompt
 * - List versions: display version list
 * - Search errors with and without hints
 * - Download errors
 * - Profile update status in success note
 * - Warnings batched into post-download note
 */

import * as clack from "@clack/prompts";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  skillDownloadFlow,
  type SkillDownloadFlowCallbacks,
} from "./skillDownload.js";

vi.mock("@clack/prompts", () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  confirm: vi.fn(),
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

describe("skillDownloadFlow", () => {
  let mockCallbacks: SkillDownloadFlowCallbacks;
  let spinnerMock: {
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    message: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(clack.isCancel).mockReturnValue(false);

    spinnerMock = {
      start: vi.fn(),
      stop: vi.fn(),
      message: vi.fn(),
    };
    vi.mocked(clack.spinner).mockReturnValue(spinnerMock as any);

    mockCallbacks = {
      onSearch: vi.fn().mockResolvedValue({
        status: "ready",
        targetVersion: "1.0.0",
        isUpdate: false,
      }),
      onDownload: vi.fn().mockResolvedValue({
        success: true,
        version: "1.0.0",
        isUpdate: false,
        installedTo: "/home/user/.claude/skills/my-skill",
        skillDisplayName: "my-skill",
        profileUpdateMessage: 'Added "my-skill" to default skillset manifest',
        warnings: [],
      }),
    };
  });

  describe("happy path: new download", () => {
    it("should not call intro or outro (top-level caller handles framing)", async () => {
      await skillDownloadFlow({
        skillDisplayName: "my-skill",
        callbacks: mockCallbacks,
      });

      expect(clack.intro).not.toHaveBeenCalled();
      expect(clack.outro).not.toHaveBeenCalled();
    });

    it("should show search spinner", async () => {
      await skillDownloadFlow({
        skillDisplayName: "my-skill",
        callbacks: mockCallbacks,
      });

      expect(spinnerMock.start).toHaveBeenCalledWith("Searching registries...");
    });

    it("should call onSearch and onDownload callbacks", async () => {
      await skillDownloadFlow({
        skillDisplayName: "my-skill",
        callbacks: mockCallbacks,
      });

      expect(mockCallbacks.onSearch).toHaveBeenCalledTimes(1);
      expect(mockCallbacks.onDownload).toHaveBeenCalledTimes(1);
    });

    it("should show download spinner with skill name", async () => {
      await skillDownloadFlow({
        skillDisplayName: "my-skill",
        callbacks: mockCallbacks,
      });

      expect(spinnerMock.start).toHaveBeenCalledWith(
        'Downloading "my-skill"...',
      );
    });

    it("should display next steps note with install location", async () => {
      await skillDownloadFlow({
        skillDisplayName: "my-skill",
        callbacks: mockCallbacks,
      });

      expect(clack.note).toHaveBeenCalledWith(
        expect.stringContaining("/home/user/.claude/skills/my-skill"),
        "Next Steps",
      );
    });

    it("should display profile update info in next steps note", async () => {
      await skillDownloadFlow({
        skillDisplayName: "my-skill",
        callbacks: mockCallbacks,
      });

      expect(clack.note).toHaveBeenCalledWith(
        expect.stringContaining("Added"),
        "Next Steps",
      );
    });

    it("should include statusMessage in result", async () => {
      const result = await skillDownloadFlow({
        skillDisplayName: "my-skill",
        callbacks: mockCallbacks,
      });

      expect(result?.statusMessage).toContain("Downloaded");
      expect(result?.statusMessage).toContain("my-skill");
    });

    it("should return version and isUpdate", async () => {
      const result = await skillDownloadFlow({
        skillDisplayName: "my-skill",
        callbacks: mockCallbacks,
      });

      expect(result?.version).toBe("1.0.0");
      expect(result?.isUpdate).toBe(false);
      expect(result?.statusMessage).toBeDefined();
    });
  });

  describe("happy path: update existing skill", () => {
    beforeEach(() => {
      mockCallbacks.onSearch = vi.fn().mockResolvedValue({
        status: "ready",
        targetVersion: "2.0.0",
        isUpdate: true,
        currentVersion: "1.0.0",
      });
      mockCallbacks.onDownload = vi.fn().mockResolvedValue({
        success: true,
        version: "2.0.0",
        isUpdate: true,
        installedTo: "/home/user/.claude/skills/my-skill",
        skillDisplayName: "my-skill",
        warnings: [],
      });
    });

    it("should show update-specific download spinner message", async () => {
      await skillDownloadFlow({
        skillDisplayName: "my-skill",
        callbacks: mockCallbacks,
      });

      expect(spinnerMock.start).toHaveBeenCalledWith(
        'Updating "my-skill" from 1.0.0 to 2.0.0...',
      );
    });

    it("should include statusMessage with Updated", async () => {
      const result = await skillDownloadFlow({
        skillDisplayName: "my-skill",
        callbacks: mockCallbacks,
      });

      expect(result?.statusMessage).toContain("Updated");
    });

    it("should return isUpdate: true", async () => {
      const result = await skillDownloadFlow({
        skillDisplayName: "my-skill",
        callbacks: mockCallbacks,
      });

      expect(result?.version).toBe("2.0.0");
      expect(result?.isUpdate).toBe(true);
      expect(result?.statusMessage).toBeDefined();
    });
  });

  describe("already current: user confirms re-download", () => {
    beforeEach(() => {
      mockCallbacks.onSearch = vi.fn().mockResolvedValue({
        status: "already-current",
        version: "1.0.0",
      });
      mockCallbacks.onDownload = vi.fn().mockResolvedValue({
        success: true,
        version: "1.0.0",
        isUpdate: true,
        installedTo: "/home/user/.claude/skills/my-skill",
        skillDisplayName: "my-skill",
        warnings: [],
      });
      vi.mocked(clack.confirm).mockResolvedValueOnce(true);
    });

    it("should show already-at-version message before prompting", async () => {
      await skillDownloadFlow({
        skillDisplayName: "my-skill",
        callbacks: mockCallbacks,
      });

      expect(clack.log.success).toHaveBeenCalledWith(
        expect.stringContaining("already at version 1.0.0"),
      );
    });

    it("should prompt user to re-download", async () => {
      await skillDownloadFlow({
        skillDisplayName: "my-skill",
        callbacks: mockCallbacks,
      });

      expect(clack.confirm).toHaveBeenCalledTimes(1);
    });

    it("should call onDownload when user confirms", async () => {
      await skillDownloadFlow({
        skillDisplayName: "my-skill",
        callbacks: mockCallbacks,
      });

      expect(mockCallbacks.onDownload).toHaveBeenCalledTimes(1);
    });

    it("should return download result", async () => {
      const result = await skillDownloadFlow({
        skillDisplayName: "my-skill",
        callbacks: mockCallbacks,
      });

      expect(result).toEqual({
        version: "1.0.0",
        isUpdate: true,
        statusMessage: 'Updated "my-skill" to 1.0.0',
      });
    });
  });

  describe("already current: user declines re-download", () => {
    beforeEach(() => {
      mockCallbacks.onSearch = vi.fn().mockResolvedValue({
        status: "already-current",
        version: "1.0.0",
      });
      vi.mocked(clack.confirm).mockResolvedValueOnce(false);
    });

    it("should not call onDownload", async () => {
      await skillDownloadFlow({
        skillDisplayName: "my-skill",
        callbacks: mockCallbacks,
      });

      expect(mockCallbacks.onDownload).not.toHaveBeenCalled();
    });

    it("should return result with statusMessage Already up to date", async () => {
      const result = await skillDownloadFlow({
        skillDisplayName: "my-skill",
        callbacks: mockCallbacks,
      });

      expect(result?.statusMessage).toContain("Already up to date");
      expect(result?.version).toBe("1.0.0");
      expect(result?.isUpdate).toBe(false);
    });
  });

  describe("already current: user cancels at prompt", () => {
    beforeEach(() => {
      mockCallbacks.onSearch = vi.fn().mockResolvedValue({
        status: "already-current",
        version: "1.0.0",
      });
      const cancelSymbol = Symbol.for("cancel");
      vi.mocked(clack.confirm).mockResolvedValueOnce(cancelSymbol as any);
      vi.mocked(clack.isCancel).mockImplementation(
        (value) => value === cancelSymbol,
      );
    });

    it("should not call onDownload", async () => {
      await skillDownloadFlow({
        skillDisplayName: "my-skill",
        callbacks: mockCallbacks,
      });

      expect(mockCallbacks.onDownload).not.toHaveBeenCalled();
    });

    it("should return null", async () => {
      const result = await skillDownloadFlow({
        skillDisplayName: "my-skill",
        callbacks: mockCallbacks,
      });

      expect(result).toBeNull();
    });
  });

  describe("list versions", () => {
    beforeEach(() => {
      mockCallbacks.onSearch = vi.fn().mockResolvedValue({
        status: "list-versions",
        formattedVersionList:
          "Dist-tags:\n  latest: 1.0.0\n\nVersions:\n  1.0.0 - 1/1/2025",
        versionCount: 1,
      });
    });

    it("should display version list in a note", async () => {
      await skillDownloadFlow({
        skillDisplayName: "my-skill",
        callbacks: mockCallbacks,
      });

      expect(clack.note).toHaveBeenCalledWith(
        expect.stringContaining("Dist-tags"),
        "Available Versions",
      );
    });

    it("should not call onDownload", async () => {
      await skillDownloadFlow({
        skillDisplayName: "my-skill",
        callbacks: mockCallbacks,
      });

      expect(mockCallbacks.onDownload).not.toHaveBeenCalled();
    });
  });

  describe("search error", () => {
    beforeEach(() => {
      mockCallbacks.onSearch = vi.fn().mockResolvedValue({
        status: "error",
        error: 'Skill "my-skill" not found in any registry.',
      });
    });

    it("should stop spinner with failure", async () => {
      await skillDownloadFlow({
        skillDisplayName: "my-skill",
        callbacks: mockCallbacks,
      });

      expect(spinnerMock.stop).toHaveBeenCalledWith("Not found");
    });

    it("should show error message", async () => {
      await skillDownloadFlow({
        skillDisplayName: "my-skill",
        callbacks: mockCallbacks,
      });

      expect(clack.log.error).toHaveBeenCalledWith(
        'Skill "my-skill" not found in any registry.',
      );
    });

    it("should return null", async () => {
      const result = await skillDownloadFlow({
        skillDisplayName: "my-skill",
        callbacks: mockCallbacks,
      });

      expect(result).toBeNull();
    });
  });

  describe("search error with hint", () => {
    it("should show error and hint note", async () => {
      mockCallbacks.onSearch = vi.fn().mockResolvedValue({
        status: "error",
        error: "No authentication configured for registry.",
        hint: "Add registry credentials to your .nori-config.json file.",
      });

      await skillDownloadFlow({
        skillDisplayName: "my-skill",
        callbacks: mockCallbacks,
      });

      expect(clack.log.error).toHaveBeenCalledWith(
        "No authentication configured for registry.",
      );
      expect(clack.note).toHaveBeenCalledWith(
        "Add registry credentials to your .nori-config.json file.",
        "Hint",
      );
    });
  });

  describe("download error", () => {
    beforeEach(() => {
      mockCallbacks.onDownload = vi.fn().mockResolvedValue({
        success: false,
        error: 'Failed to download skill "my-skill": network timeout',
      });
    });

    it("should stop spinner with failure", async () => {
      await skillDownloadFlow({
        skillDisplayName: "my-skill",
        callbacks: mockCallbacks,
      });

      expect(spinnerMock.stop).toHaveBeenCalledWith("Failed");
    });

    it("should show error message", async () => {
      await skillDownloadFlow({
        skillDisplayName: "my-skill",
        callbacks: mockCallbacks,
      });

      expect(clack.log.error).toHaveBeenCalledWith(
        'Failed to download skill "my-skill": network timeout',
      );
    });

    it("should return null", async () => {
      const result = await skillDownloadFlow({
        skillDisplayName: "my-skill",
        callbacks: mockCallbacks,
      });

      expect(result).toBeNull();
    });
  });

  describe("download with warnings", () => {
    beforeEach(() => {
      mockCallbacks.onDownload = vi.fn().mockResolvedValue({
        success: true,
        version: "1.0.0",
        isUpdate: false,
        installedTo: "/home/user/.claude/skills/my-skill",
        skillDisplayName: "my-skill",
        warnings: [
          "Warning: Could not persist skill to profile: permission denied",
          "Warning: Could not update nori.json: file locked",
        ],
      });
    });

    it("should batch warnings into a note", async () => {
      await skillDownloadFlow({
        skillDisplayName: "my-skill",
        callbacks: mockCallbacks,
      });

      expect(clack.note).toHaveBeenCalledWith(
        expect.stringContaining("permission denied"),
        "Warnings",
      );
      expect(clack.note).toHaveBeenCalledWith(
        expect.stringContaining("file locked"),
        "Warnings",
      );
    });

    it("should still include statusMessage with Downloaded", async () => {
      const result = await skillDownloadFlow({
        skillDisplayName: "my-skill",
        callbacks: mockCallbacks,
      });

      expect(result?.statusMessage).toContain("Downloaded");
    });
  });

  describe("download without profile update", () => {
    beforeEach(() => {
      mockCallbacks.onDownload = vi.fn().mockResolvedValue({
        success: true,
        version: "1.0.0",
        isUpdate: false,
        installedTo: "/home/user/.claude/skills/my-skill",
        skillDisplayName: "my-skill",
        profileUpdateMessage: null,
        warnings: [],
      });
    });

    it("should not include profile info in next steps", async () => {
      await skillDownloadFlow({
        skillDisplayName: "my-skill",
        callbacks: mockCallbacks,
      });

      const noteCall = vi
        .mocked(clack.note)
        .mock.calls.find((call) => call[1] === "Next Steps");
      expect(noteCall).toBeDefined();
      expect(noteCall![0]).toContain("Installed to:");
      expect(noteCall![0]).not.toContain("Added");
    });
  });
});
