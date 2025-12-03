/**
 * Tests for registry-search CLI command
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock the registrar API
vi.mock("@/api/registrar.js", () => ({
  registrarApi: {
    searchPackages: vi.fn(),
  },
}));

// Mock console methods to capture output
const mockConsoleLog = vi
  .spyOn(console, "log")
  .mockImplementation(() => undefined);
const mockConsoleError = vi
  .spyOn(console, "error")
  .mockImplementation(() => undefined);

import { registrarApi } from "@/api/registrar.js";

import { registrySearchMain } from "./registrySearch.js";

describe("registry-search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("registrySearchMain", () => {
    it("should display search results with names and descriptions", async () => {
      const mockPackages = [
        {
          id: "1",
          name: "typescript-profile",
          description: "A TypeScript developer profile",
          authorEmail: "test@example.com",
          createdAt: "2024-01-01",
          updatedAt: "2024-01-01",
        },
        {
          id: "2",
          name: "react-developer",
          description: "React development configuration",
          authorEmail: "test@example.com",
          createdAt: "2024-01-01",
          updatedAt: "2024-01-01",
        },
      ];

      vi.mocked(registrarApi.searchPackages).mockResolvedValue(mockPackages);

      await registrySearchMain({ query: "typescript" });

      // Verify API was called with query
      expect(registrarApi.searchPackages).toHaveBeenCalledWith({
        query: "typescript",
      });

      // Verify output contains package names and descriptions
      const allOutput = mockConsoleLog.mock.calls
        .map((call) => call.join(" "))
        .join("\n");
      expect(allOutput).toContain("typescript-profile");
      expect(allOutput).toContain("A TypeScript developer profile");
      expect(allOutput).toContain("react-developer");
      expect(allOutput).toContain("React development configuration");
    });

    it("should display message when no results found", async () => {
      vi.mocked(registrarApi.searchPackages).mockResolvedValue([]);

      await registrySearchMain({ query: "nonexistent" });

      expect(registrarApi.searchPackages).toHaveBeenCalledWith({
        query: "nonexistent",
      });

      // Verify "no results" message is displayed
      const allOutput = mockConsoleLog.mock.calls
        .map((call) => call.join(" "))
        .join("\n");
      expect(allOutput.toLowerCase()).toContain("no");
      expect(allOutput.toLowerCase()).toMatch(/found|results|profiles/);
    });

    it("should handle API errors gracefully", async () => {
      vi.mocked(registrarApi.searchPackages).mockRejectedValue(
        new Error("Network error: Failed to fetch"),
      );

      await registrySearchMain({ query: "test" });

      // Verify error message is displayed
      const allErrorOutput = mockConsoleError.mock.calls
        .map((call) => call.join(" "))
        .join("\n");
      expect(allErrorOutput.toLowerCase()).toContain("error");
      expect(allErrorOutput).toContain("Network error");
    });

    it("should display result count", async () => {
      const mockPackages = [
        {
          id: "1",
          name: "profile-one",
          description: "First profile",
          authorEmail: "test@example.com",
          createdAt: "2024-01-01",
          updatedAt: "2024-01-01",
        },
        {
          id: "2",
          name: "profile-two",
          description: "Second profile",
          authorEmail: "test@example.com",
          createdAt: "2024-01-01",
          updatedAt: "2024-01-01",
        },
        {
          id: "3",
          name: "profile-three",
          description: "Third profile",
          authorEmail: "test@example.com",
          createdAt: "2024-01-01",
          updatedAt: "2024-01-01",
        },
      ];

      vi.mocked(registrarApi.searchPackages).mockResolvedValue(mockPackages);

      await registrySearchMain({ query: "profile" });

      // Verify count is shown
      const allOutput = mockConsoleLog.mock.calls
        .map((call) => call.join(" "))
        .join("\n");
      expect(allOutput).toContain("3");
    });
  });
});
