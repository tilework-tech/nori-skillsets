import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { registrarApi } from "./registrar.js";

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("registrarApi", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("searchPackages", () => {
    it("should return array of packages matching query", async () => {
      const mockPackages = [
        {
          id: "pkg-1",
          name: "test-profile",
          description: "A test profile",
          authorEmail: "test@example.com",
          createdAt: "2024-01-01T00:00:00.000Z",
          updatedAt: "2024-01-01T00:00:00.000Z",
        },
        {
          id: "pkg-2",
          name: "another-profile",
          description: "Another test profile",
          authorEmail: "test@example.com",
          createdAt: "2024-01-02T00:00:00.000Z",
          updatedAt: "2024-01-02T00:00:00.000Z",
        },
      ];

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockPackages),
      });

      const result = await registrarApi.searchPackages({ query: "test" });

      expect(result).toEqual(mockPackages);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://registrar.tilework.tech/api/packages/search?q=test",
        expect.objectContaining({
          method: "GET",
        }),
      );
    });

    it("should return empty array when no results", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([]),
      });

      const result = await registrarApi.searchPackages({
        query: "nonexistent",
      });

      expect(result).toEqual([]);
    });

    it("should pass limit and offset query params", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([]),
      });

      await registrarApi.searchPackages({
        query: "test",
        limit: 10,
        offset: 20,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://registrar.tilework.tech/api/packages/search?q=test&limit=10&offset=20",
        expect.objectContaining({
          method: "GET",
        }),
      );
    });

    it("should throw error on non-OK response", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: "Internal server error" }),
      });

      await expect(
        registrarApi.searchPackages({ query: "test" }),
      ).rejects.toThrow("Internal server error");
    });
  });

  describe("getPackument", () => {
    it("should return packument for package name", async () => {
      const mockPackument = {
        name: "test-profile",
        description: "A test profile",
        "dist-tags": { latest: "1.0.0" },
        versions: {
          "1.0.0": {
            name: "test-profile",
            version: "1.0.0",
            dist: {
              tarball: "/packages/test-profile/tarball/test-profile-1.0.0.tgz",
            },
          },
        },
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockPackument),
      });

      const result = await registrarApi.getPackument({
        packageName: "test-profile",
      });

      expect(result).toEqual(mockPackument);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://registrar.tilework.tech/api/packages/test-profile",
        expect.objectContaining({
          method: "GET",
        }),
      );
    });

    it("should throw error when package not found", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ error: "Package not found" }),
      });

      await expect(
        registrarApi.getPackument({ packageName: "nonexistent" }),
      ).rejects.toThrow("Package not found");
    });
  });

  describe("downloadTarball", () => {
    it("should return ArrayBuffer on successful download", async () => {
      const mockTarballData = new ArrayBuffer(100);

      mockFetch.mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(mockTarballData),
      });

      const result = await registrarApi.downloadTarball({
        packageName: "test-profile",
        version: "1.0.0",
      });

      expect(result).toBe(mockTarballData);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://registrar.tilework.tech/api/packages/test-profile/tarball/test-profile-1.0.0.tgz",
        expect.objectContaining({
          method: "GET",
        }),
      );
    });

    it("should throw error when tarball not found", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ error: "Tarball not found" }),
      });

      await expect(
        registrarApi.downloadTarball({
          packageName: "nonexistent",
          version: "1.0.0",
        }),
      ).rejects.toThrow("Tarball not found");
    });

    it("should fetch latest version when no version specified", async () => {
      // First call to getPackument to resolve latest version
      const mockPackument = {
        name: "test-profile",
        "dist-tags": { latest: "2.0.0" },
        versions: {
          "1.0.0": { name: "test-profile", version: "1.0.0" },
          "2.0.0": { name: "test-profile", version: "2.0.0" },
        },
      };

      const mockTarballData = new ArrayBuffer(100);

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockPackument),
        })
        .mockResolvedValueOnce({
          ok: true,
          arrayBuffer: () => Promise.resolve(mockTarballData),
        });

      const result = await registrarApi.downloadTarball({
        packageName: "test-profile",
      });

      expect(result).toBe(mockTarballData);

      // First call should be to get packument
      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        "https://registrar.tilework.tech/api/packages/test-profile",
        expect.objectContaining({
          method: "GET",
        }),
      );

      // Second call should be to download tarball with resolved version
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        "https://registrar.tilework.tech/api/packages/test-profile/tarball/test-profile-2.0.0.tgz",
        expect.objectContaining({
          method: "GET",
        }),
      );
    });
  });
});
