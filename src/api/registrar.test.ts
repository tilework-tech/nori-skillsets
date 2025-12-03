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

    it("should use custom registryUrl when provided", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([]),
      });

      await registrarApi.searchPackages({
        query: "test",
        registryUrl: "https://private-registry.example.com",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://private-registry.example.com/api/packages/search?q=test",
        expect.objectContaining({
          method: "GET",
        }),
      );
    });

    it("should include auth token header when provided", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([]),
      });

      await registrarApi.searchPackages({
        query: "test",
        registryUrl: "https://private-registry.example.com",
        authToken: "test-auth-token",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://private-registry.example.com/api/packages/search?q=test",
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            Authorization: "Bearer test-auth-token",
          }),
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

    it("should use custom registryUrl when provided", async () => {
      const mockPackument = {
        name: "test-profile",
        "dist-tags": { latest: "1.0.0" },
        versions: {
          "1.0.0": { name: "test-profile", version: "1.0.0" },
        },
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockPackument),
      });

      await registrarApi.getPackument({
        packageName: "test-profile",
        registryUrl: "https://private-registry.example.com",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://private-registry.example.com/api/packages/test-profile",
        expect.objectContaining({
          method: "GET",
        }),
      );
    });

    it("should include auth token header when provided", async () => {
      const mockPackument = {
        name: "test-profile",
        "dist-tags": { latest: "1.0.0" },
        versions: {
          "1.0.0": { name: "test-profile", version: "1.0.0" },
        },
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockPackument),
      });

      await registrarApi.getPackument({
        packageName: "test-profile",
        registryUrl: "https://private-registry.example.com",
        authToken: "test-auth-token",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://private-registry.example.com/api/packages/test-profile",
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            Authorization: "Bearer test-auth-token",
          }),
        }),
      );
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

    it("should use custom registryUrl when provided", async () => {
      const mockTarballData = new ArrayBuffer(100);

      mockFetch.mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(mockTarballData),
      });

      await registrarApi.downloadTarball({
        packageName: "test-profile",
        version: "1.0.0",
        registryUrl: "https://private-registry.example.com",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://private-registry.example.com/api/packages/test-profile/tarball/test-profile-1.0.0.tgz",
        expect.objectContaining({
          method: "GET",
        }),
      );
    });

    it("should include auth token header when provided", async () => {
      const mockTarballData = new ArrayBuffer(100);

      mockFetch.mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(mockTarballData),
      });

      await registrarApi.downloadTarball({
        packageName: "test-profile",
        version: "1.0.0",
        registryUrl: "https://private-registry.example.com",
        authToken: "test-auth-token",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://private-registry.example.com/api/packages/test-profile/tarball/test-profile-1.0.0.tgz",
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            Authorization: "Bearer test-auth-token",
          }),
        }),
      );
    });

    it("should pass registryUrl and authToken when resolving latest version", async () => {
      const mockPackument = {
        name: "test-profile",
        "dist-tags": { latest: "2.0.0" },
        versions: {
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

      await registrarApi.downloadTarball({
        packageName: "test-profile",
        registryUrl: "https://private-registry.example.com",
        authToken: "test-auth-token",
      });

      // First call should be to get packument with auth
      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        "https://private-registry.example.com/api/packages/test-profile",
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            Authorization: "Bearer test-auth-token",
          }),
        }),
      );

      // Second call should be to download tarball with auth
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        "https://private-registry.example.com/api/packages/test-profile/tarball/test-profile-2.0.0.tgz",
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            Authorization: "Bearer test-auth-token",
          }),
        }),
      );
    });
  });

  describe("searchPackagesOnRegistry", () => {
    it("should search packages on a custom registry URL without auth", async () => {
      const mockPackages = [
        {
          id: "pkg-1",
          name: "custom-profile",
          description: "A custom profile",
          authorEmail: "test@example.com",
          createdAt: "2024-01-01T00:00:00.000Z",
          updatedAt: "2024-01-01T00:00:00.000Z",
        },
      ];

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockPackages),
      });

      const result = await registrarApi.searchPackagesOnRegistry({
        query: "custom",
        registryUrl: "https://custom.registry.com",
      });

      expect(result).toEqual(mockPackages);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://custom.registry.com/api/packages/search?q=custom",
        expect.objectContaining({
          method: "GET",
        }),
      );
    });

    it("should include Authorization header when authToken is provided", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([]),
      });

      await registrarApi.searchPackagesOnRegistry({
        query: "test",
        registryUrl: "https://private.registry.com",
        authToken: "secret-token-123",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://private.registry.com/api/packages/search?q=test",
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            Authorization: "Bearer secret-token-123",
          }),
        }),
      );
    });

    it("should not include Authorization header when authToken is null", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([]),
      });

      await registrarApi.searchPackagesOnRegistry({
        query: "test",
        registryUrl: "https://public.registry.com",
        authToken: null,
      });

      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs[1].headers).toEqual({});
    });

    it("should pass limit and offset query params", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([]),
      });

      await registrarApi.searchPackagesOnRegistry({
        query: "test",
        registryUrl: "https://custom.registry.com",
        limit: 5,
        offset: 10,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://custom.registry.com/api/packages/search?q=test&limit=5&offset=10",
        expect.anything(),
      );
    });

    it("should throw error on non-OK response", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ error: "Unauthorized" }),
      });

      await expect(
        registrarApi.searchPackagesOnRegistry({
          query: "test",
          registryUrl: "https://private.registry.com",
          authToken: "invalid-token",
        }),
      ).rejects.toThrow("Unauthorized");
    });
  });

  describe("uploadProfile", () => {
    it("should upload profile with multipart form data", async () => {
      const mockResponse = {
        name: "test-profile",
        version: "1.0.0",
        description: "Test description",
        tarballSha: "sha512-abc123",
        createdAt: "2024-01-01T00:00:00.000Z",
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const archiveData = new ArrayBuffer(100);
      const result = await registrarApi.uploadProfile({
        packageName: "test-profile",
        version: "1.0.0",
        archiveData,
        authToken: "test-token",
      });

      expect(result).toEqual(mockResponse);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://registrar.tilework.tech/api/packages/test-profile/profile",
        expect.objectContaining({
          method: "PUT",
          headers: expect.objectContaining({
            Authorization: "Bearer test-token",
          }),
        }),
      );

      // Verify the body is FormData
      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs[1].body).toBeInstanceOf(FormData);
    });

    it("should include description in form data when provided", async () => {
      const mockResponse = {
        name: "test-profile",
        version: "1.0.0",
        description: "Custom description",
        tarballSha: "sha512-abc123",
        createdAt: "2024-01-01T00:00:00.000Z",
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const archiveData = new ArrayBuffer(100);
      await registrarApi.uploadProfile({
        packageName: "test-profile",
        version: "1.0.0",
        archiveData,
        description: "Custom description",
        authToken: "test-token",
      });

      // Verify FormData includes description
      const callArgs = mockFetch.mock.calls[0];
      const formData = callArgs[1].body as FormData;
      expect(formData.get("description")).toBe("Custom description");
    });

    it("should throw error on unauthorized (401)", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ error: "Unauthorized" }),
      });

      const archiveData = new ArrayBuffer(100);
      await expect(
        registrarApi.uploadProfile({
          packageName: "test-profile",
          version: "1.0.0",
          archiveData,
          authToken: "invalid-token",
        }),
      ).rejects.toThrow("Unauthorized");
    });

    it("should throw error on forbidden (403)", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 403,
        json: () =>
          Promise.resolve({
            error: "You are not a maintainer of package test-profile",
          }),
      });

      const archiveData = new ArrayBuffer(100);
      await expect(
        registrarApi.uploadProfile({
          packageName: "test-profile",
          version: "1.0.0",
          archiveData,
          authToken: "test-token",
        }),
      ).rejects.toThrow("You are not a maintainer");
    });

    it("should throw error on version conflict (409)", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 409,
        json: () =>
          Promise.resolve({
            error: "Version 1.0.0 already exists for package test-profile",
          }),
      });

      const archiveData = new ArrayBuffer(100);
      await expect(
        registrarApi.uploadProfile({
          packageName: "test-profile",
          version: "1.0.0",
          archiveData,
          authToken: "test-token",
        }),
      ).rejects.toThrow("already exists");
    });

    it("should throw error on validation failure (400)", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        json: () =>
          Promise.resolve({ error: "Profile must contain CLAUDE.md" }),
      });

      const archiveData = new ArrayBuffer(100);
      await expect(
        registrarApi.uploadProfile({
          packageName: "test-profile",
          version: "1.0.0",
          archiveData,
          authToken: "test-token",
        }),
      ).rejects.toThrow("CLAUDE.md");
    });

    it("should use custom registryUrl when provided", async () => {
      const mockResponse = {
        name: "test-profile",
        version: "1.0.0",
        tarballSha: "sha512-abc123",
        createdAt: "2024-01-01T00:00:00.000Z",
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const archiveData = new ArrayBuffer(100);
      await registrarApi.uploadProfile({
        packageName: "test-profile",
        version: "1.0.0",
        archiveData,
        authToken: "test-token",
        registryUrl: "https://private-registry.example.com",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://private-registry.example.com/api/packages/test-profile/profile",
        expect.objectContaining({
          method: "PUT",
          headers: expect.objectContaining({
            Authorization: "Bearer test-token",
          }),
        }),
      );
    });

    it("should default to REGISTRAR_URL when registryUrl not provided", async () => {
      const mockResponse = {
        name: "test-profile",
        version: "1.0.0",
        tarballSha: "sha512-abc123",
        createdAt: "2024-01-01T00:00:00.000Z",
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const archiveData = new ArrayBuffer(100);
      await registrarApi.uploadProfile({
        packageName: "test-profile",
        version: "1.0.0",
        archiveData,
        authToken: "test-token",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://registrar.tilework.tech/api/packages/test-profile/profile",
        expect.anything(),
      );
    });
  });
});
