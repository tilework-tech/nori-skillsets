/**
 * Tests for the config migration system
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { migrate, migrations } from "./migration.js";

describe("migrate", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "migration-test-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe("error handling", () => {
    it("should throw error when previousVersion is null", async () => {
      const config = { installDir: tempDir };

      await expect(
        migrate({
          previousVersion: null as unknown as string,
          config,
          installDir: tempDir,
        }),
      ).rejects.toThrow("previousVersion is required");
    });

    it("should throw error when previousVersion is undefined", async () => {
      const config = { installDir: tempDir };

      await expect(
        migrate({
          previousVersion: undefined as unknown as string,
          config,
          installDir: tempDir,
        }),
      ).rejects.toThrow("previousVersion is required");
    });

    it("should throw error when previousVersion is empty string", async () => {
      const config = { installDir: tempDir };

      await expect(
        migrate({
          previousVersion: "",
          config,
          installDir: tempDir,
        }),
      ).rejects.toThrow("previousVersion is required");
    });

    it("should throw error when previousVersion is invalid semver", async () => {
      const config = { installDir: tempDir };

      await expect(
        migrate({
          previousVersion: "not-a-version",
          config,
          installDir: tempDir,
        }),
      ).rejects.toThrow("Invalid previousVersion");
    });
  });

  describe("migration ordering", () => {
    it("should skip migrations for versions <= previousVersion", async () => {
      // If user is at 19.0.0, they should skip the 19.0.0 migration
      const config = {
        installDir: tempDir,
        version: "19.0.0",
      };

      const result = await migrate({
        previousVersion: "19.0.0",
        config,
        installDir: tempDir,
      });

      // Should return config unchanged (no migrations applied)
      expect(result.version).toBe("19.0.0");
    });

    it("should apply migrations for versions > previousVersion", async () => {
      // If user is at 18.0.0, they should get the 19.0.0 migration
      const config = {
        installDir: tempDir,
        // Old flat auth format
        username: "test@example.com",
        password: "password123",
        organizationUrl: "https://example.com",
      } as any;

      const result = await migrate({
        previousVersion: "18.0.0",
        config,
        installDir: tempDir,
      });

      // Version should be updated to latest migration version
      expect(result.version).toBe("19.0.0");
    });

    it("should apply migrations in semver order", async () => {
      // Verify migrations are sorted by semver
      const sortedVersions = migrations.map((m) => m.version);

      // Migrations should be in ascending order
      for (let i = 1; i < sortedVersions.length; i++) {
        const prev = sortedVersions[i - 1];
        const curr = sortedVersions[i];
        // Use semver comparison
        const semver = await import("semver");
        expect(semver.gt(curr, prev)).toBe(true);
      }
    });

    it("should return original config when no migrations apply", async () => {
      // If user is already at or past the latest migration version
      const config = {
        installDir: tempDir,
        version: "99.0.0",
        auth: {
          username: "test@example.com",
          organizationUrl: "https://example.com",
          refreshToken: "token",
        },
      };

      const result = await migrate({
        previousVersion: "99.0.0",
        config,
        installDir: tempDir,
      });

      // Config should be unchanged
      expect(result).toEqual(config);
    });
  });

  describe("version tracking", () => {
    it("should update config.version after each migration", async () => {
      const config = {
        installDir: tempDir,
        username: "test@example.com",
        password: "password123",
        organizationUrl: "https://example.com",
      } as any;

      const result = await migrate({
        previousVersion: "18.0.0",
        config,
        installDir: tempDir,
      });

      // After migrations, version should reflect the last applied migration
      expect(result.version).toBeDefined();
      // Should be at least 19.0.0 (first migration)
      const semver = await import("semver");
      expect(semver.gte(result.version!, "19.0.0")).toBe(true);
    });
  });
});

describe("migration 19.0.0 - consolidate auth structure", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "migration-19-test-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("should transform flat auth fields to nested auth object", async () => {
    const config = {
      installDir: tempDir,
      username: "test@example.com",
      password: "password123",
      organizationUrl: "https://example.com",
    } as any;

    const result = await migrate({
      previousVersion: "18.0.0",
      config,
      installDir: tempDir,
    });

    // Should have nested auth object
    expect(result.auth).toEqual({
      username: "test@example.com",
      password: "password123",
      organizationUrl: "https://example.com",
      refreshToken: null,
    });

    // Flat fields should be removed
    expect((result as any).username).toBeUndefined();
    expect((result as any).password).toBeUndefined();
    expect((result as any).organizationUrl).toBeUndefined();
  });

  it("should transform flat auth with refreshToken to nested auth object", async () => {
    const config = {
      installDir: tempDir,
      username: "test@example.com",
      refreshToken: "firebase-token",
      organizationUrl: "https://example.com",
    } as any;

    const result = await migrate({
      previousVersion: "18.0.0",
      config,
      installDir: tempDir,
    });

    expect(result.auth).toEqual({
      username: "test@example.com",
      refreshToken: "firebase-token",
      organizationUrl: "https://example.com",
      password: null,
    });
  });

  it("should set config.version to 19.0.0", async () => {
    const config = {
      installDir: tempDir,
      username: "test@example.com",
      password: "password123",
      organizationUrl: "https://example.com",
    } as any;

    const result = await migrate({
      previousVersion: "18.0.0",
      config,
      installDir: tempDir,
    });

    expect(result.version).toBe("19.0.0");
  });

  it("should be idempotent - handle config already in new format", async () => {
    const config = {
      installDir: tempDir,
      auth: {
        username: "test@example.com",
        password: "password123",
        organizationUrl: "https://example.com",
        refreshToken: null,
      },
    };

    const result = await migrate({
      previousVersion: "18.0.0",
      config,
      installDir: tempDir,
    });

    // Should preserve existing auth structure
    expect(result.auth).toEqual({
      username: "test@example.com",
      password: "password123",
      organizationUrl: "https://example.com",
      refreshToken: null,
    });
  });

  it("should preserve other fields during migration", async () => {
    const config = {
      installDir: tempDir,
      username: "test@example.com",
      password: "password123",
      organizationUrl: "https://example.com",
      agents: {
        "claude-code": { profile: { baseProfile: "senior-swe" } },
      },
      sendSessionTranscript: "enabled",
      autoupdate: "disabled",
      registryAuths: [
        {
          username: "reg@example.com",
          password: "regpass",
          registryUrl: "https://registry.example.com",
        },
      ],
    } as any;

    const result = await migrate({
      previousVersion: "18.0.0",
      config,
      installDir: tempDir,
    });

    // Legacy profile field should not exist after migration
    expect((result as any).profile).toBeUndefined();
    expect(result.agents).toEqual({
      "claude-code": { profile: { baseProfile: "senior-swe" } },
    });
    expect(result.sendSessionTranscript).toBe("enabled");
    expect(result.autoupdate).toBe("disabled");
    expect(result.registryAuths).toEqual([
      {
        username: "reg@example.com",
        password: "regpass",
        registryUrl: "https://registry.example.com",
      },
    ]);
  });

  it("should handle config with no auth fields", async () => {
    const config = {
      installDir: tempDir,
      agents: {
        "claude-code": { profile: { baseProfile: "senior-swe" } },
      },
    };

    const result = await migrate({
      previousVersion: "18.0.0",
      config,
      installDir: tempDir,
    });

    // Should not create auth if no auth fields present
    expect(result.auth).toBeUndefined();
    // Profile should be in agents, not top-level
    expect((result as any).profile).toBeUndefined();
    expect(result.agents).toEqual({
      "claude-code": { profile: { baseProfile: "senior-swe" } },
    });
    expect(result.version).toBe("19.0.0");
  });

  it("should handle partial auth fields gracefully", async () => {
    // Config with only username (incomplete auth)
    const config = {
      installDir: tempDir,
      username: "test@example.com",
      // Missing password and organizationUrl
    } as any;

    const result = await migrate({
      previousVersion: "18.0.0",
      config,
      installDir: tempDir,
    });

    // Should not create nested auth without complete fields
    expect(result.auth).toBeUndefined();
    // Should still remove flat field
    expect((result as any).username).toBeUndefined();
  });

  describe("profile to agents migration", () => {
    it("should transform legacy profile to agents.claude-code.profile", async () => {
      const config = {
        installDir: tempDir,
        profile: { baseProfile: "senior-swe" },
      } as any;

      const result = await migrate({
        previousVersion: "18.0.0",
        config,
        installDir: tempDir,
      });

      // Should have agents with claude-code profile
      expect(result.agents).toEqual({
        "claude-code": { profile: { baseProfile: "senior-swe" } },
      });

      // Legacy profile field should be removed
      expect((result as any).profile).toBeUndefined();
    });

    it("should preserve existing agents and remove legacy profile", async () => {
      const config = {
        installDir: tempDir,
        profile: { baseProfile: "old-profile" },
        agents: {
          "claude-code": { profile: { baseProfile: "new-profile" } },
        },
      } as any;

      const result = await migrate({
        previousVersion: "18.0.0",
        config,
        installDir: tempDir,
      });

      // Should keep agents unchanged
      expect(result.agents).toEqual({
        "claude-code": { profile: { baseProfile: "new-profile" } },
      });

      // Legacy profile field should be removed
      expect((result as any).profile).toBeUndefined();
    });

    it("should handle config with only agents (no legacy profile)", async () => {
      const config = {
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
          cursor: { profile: { baseProfile: "documenter" } },
        },
      };

      const result = await migrate({
        previousVersion: "18.0.0",
        config,
        installDir: tempDir,
      });

      // Should preserve agents unchanged
      expect(result.agents).toEqual({
        "claude-code": { profile: { baseProfile: "senior-swe" } },
        cursor: { profile: { baseProfile: "documenter" } },
      });

      // No profile field should exist
      expect((result as any).profile).toBeUndefined();
    });

    it("should merge legacy profile into existing agents for non-claude-code agent", async () => {
      const config = {
        installDir: tempDir,
        profile: { baseProfile: "senior-swe" },
        agents: {
          cursor: { profile: { baseProfile: "documenter" } },
        },
      } as any;

      const result = await migrate({
        previousVersion: "18.0.0",
        config,
        installDir: tempDir,
      });

      // Should add claude-code with legacy profile while preserving cursor
      expect(result.agents).toEqual({
        cursor: { profile: { baseProfile: "documenter" } },
        "claude-code": { profile: { baseProfile: "senior-swe" } },
      });

      // Legacy profile field should be removed
      expect((result as any).profile).toBeUndefined();
    });

    it("should handle empty agents object with legacy profile", async () => {
      const config = {
        installDir: tempDir,
        profile: { baseProfile: "amol" },
        agents: {},
      } as any;

      const result = await migrate({
        previousVersion: "18.0.0",
        config,
        installDir: tempDir,
      });

      // Should add claude-code profile to agents
      expect(result.agents).toEqual({
        "claude-code": { profile: { baseProfile: "amol" } },
      });

      // Legacy profile field should be removed
      expect((result as any).profile).toBeUndefined();
    });

    it("should handle config with no profile and no agents", async () => {
      const config = {
        installDir: tempDir,
        sendSessionTranscript: "enabled",
      };

      const result = await migrate({
        previousVersion: "18.0.0",
        config,
        installDir: tempDir,
      });

      // Should not create agents if no profile
      expect(result.agents).toBeUndefined();
      expect((result as any).profile).toBeUndefined();
    });
  });
});
