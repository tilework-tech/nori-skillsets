/**
 * Tests for registry download flow module
 *
 * These tests verify the registryDownloadFlow function behavior including:
 * - Happy path: new download and update
 * - Already-current: no download needed
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
    it("should show intro", async () => {
      await registryDownloadFlow({
        packageDisplayName: "my-skillset",
        callbacks: mockCallbacks,
      });

      expect(clack.intro).toHaveBeenCalledWith("Download Skillset");
    });

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

    it("should show outro with downloaded message", async () => {
      await registryDownloadFlow({
        packageDisplayName: "my-skillset",
        callbacks: mockCallbacks,
      });

      expect(clack.outro).toHaveBeenCalledWith(
        expect.stringContaining("Downloaded"),
      );
      expect(clack.outro).toHaveBeenCalledWith(
        expect.stringContaining("my-skillset"),
      );
    });

    it("should return version and isUpdate", async () => {
      const result = await registryDownloadFlow({
        packageDisplayName: "my-skillset",
        callbacks: mockCallbacks,
      });

      expect(result).toEqual({ version: "1.0.0", isUpdate: false });
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

    it("should show updated outro message", async () => {
      await registryDownloadFlow({
        packageDisplayName: "my-skillset",
        callbacks: mockCallbacks,
      });

      expect(clack.outro).toHaveBeenCalledWith(
        expect.stringContaining("Updated"),
      );
    });

    it("should return isUpdate: true", async () => {
      const result = await registryDownloadFlow({
        packageDisplayName: "my-skillset",
        callbacks: mockCallbacks,
      });

      expect(result).toEqual({ version: "2.0.0", isUpdate: true });
    });
  });

  describe("already current", () => {
    beforeEach(() => {
      mockCallbacks.onSearch = vi.fn().mockResolvedValue({
        status: "already-current",
        version: "1.0.0",
      });
    });

    it("should show success message", async () => {
      await registryDownloadFlow({
        packageDisplayName: "my-skillset",
        callbacks: mockCallbacks,
      });

      expect(clack.log.success).toHaveBeenCalledWith(
        expect.stringContaining("already at version 1.0.0"),
      );
    });

    it("should not call onDownload", async () => {
      await registryDownloadFlow({
        packageDisplayName: "my-skillset",
        callbacks: mockCallbacks,
      });

      expect(mockCallbacks.onDownload).not.toHaveBeenCalled();
    });

    it("should show outro", async () => {
      await registryDownloadFlow({
        packageDisplayName: "my-skillset",
        callbacks: mockCallbacks,
      });

      expect(clack.outro).toHaveBeenCalledWith("Already up to date");
    });

    it("should return version with isUpdate false", async () => {
      const result = await registryDownloadFlow({
        packageDisplayName: "my-skillset",
        callbacks: mockCallbacks,
      });

      expect(result).toEqual({ version: "1.0.0", isUpdate: false });
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

    it("should show outro with version count", async () => {
      await registryDownloadFlow({
        packageDisplayName: "my-skillset",
        callbacks: mockCallbacks,
      });

      expect(clack.outro).toHaveBeenCalledWith(
        expect.stringContaining("1 version"),
      );
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

    it("should still show success outro", async () => {
      await registryDownloadFlow({
        packageDisplayName: "my-skillset",
        callbacks: mockCallbacks,
      });

      expect(clack.outro).toHaveBeenCalledWith(
        expect.stringContaining("Downloaded"),
      );
    });
  });
});
