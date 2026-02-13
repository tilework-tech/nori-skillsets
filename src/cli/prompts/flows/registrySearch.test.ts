/**
 * Tests for registry search flow module
 *
 * These tests verify the registrySearchFlow function behavior including:
 * - Happy path: search results displayed, download hints shown
 * - No results: informational message displayed
 * - Search failure: error message displayed, returns null
 * - Empty hints: hints not displayed when empty
 */

import * as clack from "@clack/prompts";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  registrySearchFlow,
  type RegistrySearchFlowCallbacks,
} from "./registrySearch.js";

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

describe("registrySearchFlow", () => {
  let mockCallbacks: RegistrySearchFlowCallbacks;

  beforeEach(() => {
    vi.clearAllMocks();

    mockCallbacks = {
      onSearch: vi.fn().mockResolvedValue({
        success: true,
        hasResults: true,
        formattedResults:
          "Skillsets:\npublic:\n  my-skillset - A test skillset",
        downloadHints:
          "To install a skillset, run: nori-skillsets download <package-name>",
      }),
    };
  });

  describe("happy path: search results found", () => {
    it("should show intro", async () => {
      await registrySearchFlow({ callbacks: mockCallbacks });

      expect(clack.intro).toHaveBeenCalledWith("Search Nori Registry");
    });

    it("should show spinner during search", async () => {
      const spinnerMock = {
        start: vi.fn(),
        stop: vi.fn(),
        message: vi.fn(),
      };
      vi.mocked(clack.spinner).mockReturnValue(spinnerMock as any);

      await registrySearchFlow({ callbacks: mockCallbacks });

      expect(clack.spinner).toHaveBeenCalled();
      expect(spinnerMock.start).toHaveBeenCalledWith("Searching...");
      expect(spinnerMock.stop).toHaveBeenCalledWith("Search complete");
    });

    it("should call onSearch callback", async () => {
      await registrySearchFlow({ callbacks: mockCallbacks });

      expect(mockCallbacks.onSearch).toHaveBeenCalledTimes(1);
    });

    it("should display results in a note", async () => {
      await registrySearchFlow({ callbacks: mockCallbacks });

      expect(clack.note).toHaveBeenCalledWith(
        "Skillsets:\npublic:\n  my-skillset - A test skillset",
        "Results",
      );
    });

    it("should display download hints", async () => {
      await registrySearchFlow({ callbacks: mockCallbacks });

      expect(clack.log.info).toHaveBeenCalledWith(
        "To install a skillset, run: nori-skillsets download <package-name>",
      );
    });

    it("should show outro", async () => {
      await registrySearchFlow({ callbacks: mockCallbacks });

      expect(clack.outro).toHaveBeenCalledWith("Search complete");
    });

    it("should return found: true", async () => {
      const result = await registrySearchFlow({ callbacks: mockCallbacks });

      expect(result).toEqual({ found: true });
    });
  });

  describe("no results found", () => {
    beforeEach(() => {
      mockCallbacks.onSearch = vi.fn().mockResolvedValue({
        success: true,
        hasResults: false,
        query: "nonexistent",
      });
    });

    it("should show no-results message", async () => {
      await registrySearchFlow({ callbacks: mockCallbacks });

      expect(clack.log.info).toHaveBeenCalledWith(
        'No skillsets or skills found matching "nonexistent".',
      );
    });

    it("should not display a note", async () => {
      await registrySearchFlow({ callbacks: mockCallbacks });

      expect(clack.note).not.toHaveBeenCalled();
    });

    it("should show outro", async () => {
      await registrySearchFlow({ callbacks: mockCallbacks });

      expect(clack.outro).toHaveBeenCalledWith("Search complete");
    });

    it("should return found: false", async () => {
      const result = await registrySearchFlow({ callbacks: mockCallbacks });

      expect(result).toEqual({ found: false });
    });
  });

  describe("search failure", () => {
    beforeEach(() => {
      mockCallbacks.onSearch = vi.fn().mockResolvedValue({
        success: false,
        error: "Network error: could not connect to registry",
      });
    });

    it("should stop spinner with failure message", async () => {
      const spinnerMock = {
        start: vi.fn(),
        stop: vi.fn(),
        message: vi.fn(),
      };
      vi.mocked(clack.spinner).mockReturnValue(spinnerMock as any);

      await registrySearchFlow({ callbacks: mockCallbacks });

      expect(spinnerMock.stop).toHaveBeenCalledWith("Search failed");
    });

    it("should display error message", async () => {
      await registrySearchFlow({ callbacks: mockCallbacks });

      expect(clack.log.error).toHaveBeenCalledWith(
        "Network error: could not connect to registry",
      );
    });

    it("should not show outro", async () => {
      await registrySearchFlow({ callbacks: mockCallbacks });

      expect(clack.outro).not.toHaveBeenCalled();
    });

    it("should return null", async () => {
      const result = await registrySearchFlow({ callbacks: mockCallbacks });

      expect(result).toBeNull();
    });
  });

  describe("empty download hints", () => {
    beforeEach(() => {
      mockCallbacks.onSearch = vi.fn().mockResolvedValue({
        success: true,
        hasResults: true,
        formattedResults: "Skillsets:\npublic:\n  my-skillset",
        downloadHints: "",
      });
    });

    it("should not display hints when empty", async () => {
      await registrySearchFlow({ callbacks: mockCallbacks });

      expect(clack.log.info).not.toHaveBeenCalled();
    });

    it("should still display results and outro", async () => {
      await registrySearchFlow({ callbacks: mockCallbacks });

      expect(clack.note).toHaveBeenCalled();
      expect(clack.outro).toHaveBeenCalledWith("Search complete");
    });
  });
});
