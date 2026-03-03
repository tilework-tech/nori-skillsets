/**
 * Tests for registry download flow module
 *
 * These tests verify the registryDownloadFlow function behavior including:
 * - Happy path: new download and update
 * - Already-current: user prompted to re-download
 * - Already-current: user declines re-download
 * - Already-current: user cancels at prompt
 * - Already-current with warnings: user confirms re-download
 * - List versions: display version list
 * - Search errors with and without hints
 * - Download errors
 * - Skill dependency warnings batched into post-download note
 */

import * as clack from "@clack/prompts";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  registryDownloadFlow,
  type RegistryDownloadFlowCallbacks,
} from "./registryDownload.js";

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

describe("registryDownloadFlow", () => {
  let mockCallbacks: RegistryDownloadFlowCallbacks;
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
        installedTo: "/home/user/.nori/profiles/my-skillset",
        switchHint: "nori-skillsets switch my-skillset",
        profileDisplayName: "my-skillset",
        warnings: [],
      }),
    };
  });

  describe("happy path: new download", () => {
    it("should show search spinner", async () => {
      await registryDownloadFlow({
        packageDisplayName: "my-skillset",
        callbacks: mockCallbacks,
      });

      expect(spinnerMock.start).toHaveBeenCalledWith("Searching registries...");
    });

    it("should call onSearch callback", async () => {
      await registryDownloadFlow({
        packageDisplayName: "my-skillset",
        callbacks: mockCallbacks,
      });

      expect(mockCallbacks.onSearch).toHaveBeenCalledTimes(1);
    });

    it("should show download spinner with package name", async () => {
      await registryDownloadFlow({
        packageDisplayName: "my-skillset",
        callbacks: mockCallbacks,
      });

      expect(spinnerMock.start).toHaveBeenCalledWith(
        'Downloading "my-skillset"...',
      );
    });

    it("should call onDownload callback", async () => {
      await registryDownloadFlow({
        packageDisplayName: "my-skillset",
        callbacks: mockCallbacks,
      });

      expect(mockCallbacks.onDownload).toHaveBeenCalledTimes(1);
    });

    it("should display next steps note", async () => {
      await registryDownloadFlow({
        packageDisplayName: "my-skillset",
        callbacks: mockCallbacks,
      });

      expect(clack.note).toHaveBeenCalledWith(
        expect.stringContaining("/home/user/.nori/profiles/my-skillset"),
        "Next Steps",
      );
      expect(clack.note).toHaveBeenCalledWith(
        expect.stringContaining("nori-skillsets switch my-skillset"),
        "Next Steps",
      );
    });

    it("should include statusMessage in result", async () => {
      const result = await registryDownloadFlow({
        packageDisplayName: "my-skillset",
        callbacks: mockCallbacks,
      });

      expect(result?.statusMessage).toContain("Downloaded");
      expect(result?.statusMessage).toContain("my-skillset");
    });

    it("should return version and isUpdate", async () => {
      const result = await registryDownloadFlow({
        packageDisplayName: "my-skillset",
        callbacks: mockCallbacks,
      });

      expect(result?.version).toBe("1.0.0");
      expect(result?.isUpdate).toBe(false);
      expect(result?.statusMessage).toBeDefined();
    });
  });

  describe("happy path: update existing skillset", () => {
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
        installedTo: "/home/user/.nori/profiles/my-skillset",
        switchHint: "nori-skillsets switch my-skillset",
        profileDisplayName: "my-skillset",
        warnings: [],
      });
    });

    it("should show update-specific download spinner message", async () => {
      await registryDownloadFlow({
        packageDisplayName: "my-skillset",
        callbacks: mockCallbacks,
      });

      expect(spinnerMock.start).toHaveBeenCalledWith(
        'Updating "my-skillset" from 1.0.0 to 2.0.0...',
      );
    });

    it("should include statusMessage with Updated", async () => {
      const result = await registryDownloadFlow({
        packageDisplayName: "my-skillset",
        callbacks: mockCallbacks,
      });

      expect(result?.statusMessage).toContain("Updated");
    });

    it("should return isUpdate: true", async () => {
      const result = await registryDownloadFlow({
        packageDisplayName: "my-skillset",
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
        installedTo: "/home/user/.nori/profiles/my-skillset",
        switchHint: "nori-skillsets switch my-skillset",
        profileDisplayName: "my-skillset",
        warnings: [],
      });
      vi.mocked(clack.confirm).mockResolvedValueOnce(true);
    });

    it("should show already-at-version message before prompting", async () => {
      await registryDownloadFlow({
        packageDisplayName: "my-skillset",
        callbacks: mockCallbacks,
      });

      expect(clack.log.success).toHaveBeenCalledWith(
        expect.stringContaining("already at version 1.0.0"),
      );
    });

    it("should prompt user to re-download", async () => {
      await registryDownloadFlow({
        packageDisplayName: "my-skillset",
        callbacks: mockCallbacks,
      });

      expect(clack.confirm).toHaveBeenCalledTimes(1);
    });

    it("should call onDownload when user confirms", async () => {
      await registryDownloadFlow({
        packageDisplayName: "my-skillset",
        callbacks: mockCallbacks,
      });

      expect(mockCallbacks.onDownload).toHaveBeenCalledTimes(1);
    });

    it("should return download result with statusMessage", async () => {
      const result = await registryDownloadFlow({
        packageDisplayName: "my-skillset",
        callbacks: mockCallbacks,
      });

      expect(result?.version).toBe("1.0.0");
      expect(result?.isUpdate).toBe(true);
      expect(result?.statusMessage).toBeDefined();
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
      await registryDownloadFlow({
        packageDisplayName: "my-skillset",
        callbacks: mockCallbacks,
      });

      expect(mockCallbacks.onDownload).not.toHaveBeenCalled();
    });

    it("should return result with statusMessage Already up to date", async () => {
      const result = await registryDownloadFlow({
        packageDisplayName: "my-skillset",
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
      await registryDownloadFlow({
        packageDisplayName: "my-skillset",
        callbacks: mockCallbacks,
      });

      expect(mockCallbacks.onDownload).not.toHaveBeenCalled();
    });

    it("should return null", async () => {
      const result = await registryDownloadFlow({
        packageDisplayName: "my-skillset",
        callbacks: mockCallbacks,
      });

      expect(result).toBeNull();
    });
  });

  describe("already current with warnings: user confirms re-download", () => {
    beforeEach(() => {
      mockCallbacks.onSearch = vi.fn().mockResolvedValue({
        status: "already-current",
        version: "1.0.0",
        warnings: ['Warning: Failed to download skill "broken-skill": 404'],
      });
      mockCallbacks.onDownload = vi.fn().mockResolvedValue({
        success: true,
        version: "1.0.0",
        isUpdate: true,
        installedTo: "/home/user/.nori/profiles/my-skillset",
        switchHint: "nori-skillsets switch my-skillset",
        profileDisplayName: "my-skillset",
        warnings: [],
      });
      vi.mocked(clack.confirm).mockResolvedValueOnce(true);
    });

    it("should show dependency warnings before confirm prompt", async () => {
      await registryDownloadFlow({
        packageDisplayName: "my-skillset",
        callbacks: mockCallbacks,
      });

      expect(clack.note).toHaveBeenCalledWith(
        expect.stringContaining("broken-skill"),
        "Skill Dependency Warnings",
      );
    });

    it("should proceed to download after user confirms", async () => {
      await registryDownloadFlow({
        packageDisplayName: "my-skillset",
        callbacks: mockCallbacks,
      });

      expect(mockCallbacks.onDownload).toHaveBeenCalledTimes(1);
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
      await registryDownloadFlow({
        packageDisplayName: "my-skillset",
        callbacks: mockCallbacks,
      });

      expect(clack.note).toHaveBeenCalledWith(
        expect.stringContaining("Dist-tags"),
        "Available Versions",
      );
    });

    it("should not call onDownload", async () => {
      await registryDownloadFlow({
        packageDisplayName: "my-skillset",
        callbacks: mockCallbacks,
      });

      expect(mockCallbacks.onDownload).not.toHaveBeenCalled();
    });

    it("should return result with statusMessage containing version count", async () => {
      const result = await registryDownloadFlow({
        packageDisplayName: "my-skillset",
        callbacks: mockCallbacks,
      });

      expect(result?.statusMessage).toContain("1 version");
    });
  });

  describe("search error", () => {
    beforeEach(() => {
      mockCallbacks.onSearch = vi.fn().mockResolvedValue({
        status: "error",
        error: 'Skillset "my-skillset" not found in any registry.',
      });
    });

    it("should stop spinner with failure", async () => {
      await registryDownloadFlow({
        packageDisplayName: "my-skillset",
        callbacks: mockCallbacks,
      });

      expect(spinnerMock.stop).toHaveBeenCalledWith("Not found");
    });

    it("should show error message", async () => {
      await registryDownloadFlow({
        packageDisplayName: "my-skillset",
        callbacks: mockCallbacks,
      });

      expect(clack.log.error).toHaveBeenCalledWith(
        'Skillset "my-skillset" not found in any registry.',
      );
    });

    it("should not call onDownload", async () => {
      await registryDownloadFlow({
        packageDisplayName: "my-skillset",
        callbacks: mockCallbacks,
      });

      expect(mockCallbacks.onDownload).not.toHaveBeenCalled();
    });

    it("should return null", async () => {
      const result = await registryDownloadFlow({
        packageDisplayName: "my-skillset",
        callbacks: mockCallbacks,
      });

      expect(result).toBeNull();
    });
  });

  describe("search error with hint", () => {
    beforeEach(() => {
      mockCallbacks.onSearch = vi.fn().mockResolvedValue({
        status: "error",
        error: "No authentication configured for registry.",
        hint: "Add registry credentials to your .nori-config.json file.",
      });
    });

    it("should show error and hint note", async () => {
      await registryDownloadFlow({
        packageDisplayName: "my-skillset",
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
        error: 'Failed to download skillset "my-skillset": network timeout',
      });
    });

    it("should stop spinner with failure", async () => {
      await registryDownloadFlow({
        packageDisplayName: "my-skillset",
        callbacks: mockCallbacks,
      });

      expect(spinnerMock.stop).toHaveBeenCalledWith("Failed");
    });

    it("should show error message", async () => {
      await registryDownloadFlow({
        packageDisplayName: "my-skillset",
        callbacks: mockCallbacks,
      });

      expect(clack.log.error).toHaveBeenCalledWith(
        'Failed to download skillset "my-skillset": network timeout',
      );
    });

    it("should return null", async () => {
      const result = await registryDownloadFlow({
        packageDisplayName: "my-skillset",
        callbacks: mockCallbacks,
      });

      expect(result).toBeNull();
    });
  });

  describe("download with skill dependency warnings", () => {
    beforeEach(() => {
      mockCallbacks.onDownload = vi.fn().mockResolvedValue({
        success: true,
        version: "1.0.0",
        isUpdate: false,
        installedTo: "/home/user/.nori/profiles/my-skillset",
        switchHint: "nori-skillsets switch my-skillset",
        profileDisplayName: "my-skillset",
        warnings: [
          'Warning: No latest version found for skill "broken-skill"',
          'Warning: Failed to download skill "missing-skill": 404',
        ],
      });
    });

    it("should batch warnings into a note after download", async () => {
      await registryDownloadFlow({
        packageDisplayName: "my-skillset",
        callbacks: mockCallbacks,
      });

      expect(clack.note).toHaveBeenCalledWith(
        expect.stringContaining("broken-skill"),
        "Skill Dependency Warnings",
      );
      expect(clack.note).toHaveBeenCalledWith(
        expect.stringContaining("missing-skill"),
        "Skill Dependency Warnings",
      );
    });

    it("should still include statusMessage with Downloaded", async () => {
      const result = await registryDownloadFlow({
        packageDisplayName: "my-skillset",
        callbacks: mockCallbacks,
      });

      expect(result?.statusMessage).toContain("Downloaded");
    });
  });
});
