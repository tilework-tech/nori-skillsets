/**
 * Tests for config loader
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { getConfigPath } from "@/cli/config.js";

import type { Config } from "@/cli/config.js";
import type * as firebaseAuth from "firebase/auth";

import { configLoader } from "./loader.js";

// Mock Firebase SDK to avoid hitting real Firebase API
vi.mock("firebase/auth", async (importOriginal) => {
  const actual = (await importOriginal()) as typeof firebaseAuth;
  return {
    ...actual,
    signInWithEmailAndPassword: vi.fn().mockResolvedValue({
      user: { refreshToken: "mock-refresh-token" },
    }),
  };
});

vi.mock("@/providers/firebase.js", () => ({
  configureFirebase: vi.fn(),
  getFirebase: vi.fn().mockReturnValue({
    auth: {},
    app: { options: { projectId: "test-project" } },
  }),
}));

describe("configLoader", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "config-loader-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  describe("run", () => {
    it("should create config file", async () => {
      const config: Config = {
        installDir: tempDir,
        agents: { "claude-code": { profile: { baseProfile: "senior-swe" } } },
      };

      await configLoader.run({ config });

      const configFile = getConfigPath({ installDir: tempDir });
      expect(fs.existsSync(configFile)).toBe(true);

      // Verify file contents
      const fileContents = JSON.parse(fs.readFileSync(configFile, "utf-8"));
      expect(fileContents.installDir).toBe(tempDir);
      expect(fileContents.agents["claude-code"].profile).toEqual({
        baseProfile: "senior-swe",
      });
    });

    it("should include sendSessionTranscript when provided", async () => {
      const config: Config = {
        installDir: tempDir,
        agents: { "claude-code": { profile: { baseProfile: "senior-swe" } } },
        sendSessionTranscript: "enabled",
      };

      await configLoader.run({ config });

      const configFile = getConfigPath({ installDir: tempDir });
      const fileContents = JSON.parse(fs.readFileSync(configFile, "utf-8"));
      expect(fileContents.sendSessionTranscript).toBe("enabled");
    });

    it("should NOT include sendSessionTranscript when not provided", async () => {
      const config: Config = {
        installDir: tempDir,
        agents: { "claude-code": { profile: { baseProfile: "senior-swe" } } },
      };

      await configLoader.run({ config });

      const configFile = getConfigPath({ installDir: tempDir });
      const fileContents = JSON.parse(fs.readFileSync(configFile, "utf-8"));
      expect(fileContents.sendSessionTranscript).toBeUndefined();
    });

    it("should preserve existing sendSessionTranscript preference", async () => {
      const config: Config = {
        installDir: tempDir,
        agents: { "claude-code": { profile: { baseProfile: "senior-swe" } } },
        sendSessionTranscript: "disabled",
      };

      await configLoader.run({ config });

      const configFile = getConfigPath({ installDir: tempDir });
      const fileContents = JSON.parse(fs.readFileSync(configFile, "utf-8"));
      expect(fileContents.sendSessionTranscript).toBe("disabled");
    });

    it("should save agents to config file", async () => {
      const config: Config = {
        installDir: tempDir,
        agents: { "claude-code": { profile: { baseProfile: "senior-swe" } } },
      };

      await configLoader.run({ config });

      const configFile = getConfigPath({ installDir: tempDir });
      const fileContents = JSON.parse(fs.readFileSync(configFile, "utf-8"));
      expect(Object.keys(fileContents.agents)).toEqual(["claude-code"]);
    });

    it("should preserve existing agents when updating config", async () => {
      // Create existing config with agents
      const configFile = getConfigPath({ installDir: tempDir });
      fs.writeFileSync(
        configFile,
        JSON.stringify({
          installDir: tempDir,
          agents: {
            "claude-code": { profile: { baseProfile: "senior-swe" } },
          },
        }),
        "utf-8",
      );

      // Update the same agent
      const config: Config = {
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "documenter" } },
        },
      };

      await configLoader.run({ config });

      const fileContents = JSON.parse(fs.readFileSync(configFile, "utf-8"));
      expect(Object.keys(fileContents.agents)).toEqual(["claude-code"]);
      expect(fileContents.agents["claude-code"].profile.baseProfile).toBe(
        "documenter",
      );
    });

    it("should not duplicate agents when re-installing", async () => {
      // Create existing config with agents
      const configFile = getConfigPath({ installDir: tempDir });
      fs.writeFileSync(
        configFile,
        JSON.stringify({
          installDir: tempDir,
          agents: {
            "claude-code": { profile: { baseProfile: "senior-swe" } },
          },
        }),
        "utf-8",
      );

      // Re-install same agent
      const config: Config = {
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      };

      await configLoader.run({ config });

      const fileContents = JSON.parse(fs.readFileSync(configFile, "utf-8"));
      expect(Object.keys(fileContents.agents)).toEqual(["claude-code"]);
    });

    it("should save agents field with profile to config file", async () => {
      const config: Config = {
        installDir: tempDir,
        agents: {
          "claude-code": {
            profile: { baseProfile: "none" },
          },
        },
      };

      await configLoader.run({ config });

      const configFile = getConfigPath({ installDir: tempDir });
      const fileContents = JSON.parse(fs.readFileSync(configFile, "utf-8"));
      expect(fileContents.agents).toEqual({
        "claude-code": {
          profile: { baseProfile: "none" },
        },
      });
    });

    it("should preserve agents field from existing config when not provided in new config", async () => {
      // Create existing config with agents field (e.g., from switchProfile)
      const configFile = getConfigPath({ installDir: tempDir });
      fs.writeFileSync(
        configFile,
        JSON.stringify({
          installDir: tempDir,
          agents: {
            "claude-code": {
              profile: { baseProfile: "none" },
            },
          },
        }),
        "utf-8",
      );

      // Run configLoader with config that doesn't explicitly set agents
      // (simulating what noninteractive install does after switchProfile)
      const config: Config = {
        installDir: tempDir,
        agents: {
          "claude-code": {},
        },
      };

      await configLoader.run({ config });

      const fileContents = JSON.parse(fs.readFileSync(configFile, "utf-8"));
      // agents field should be merged - new config takes precedence
      expect(Object.keys(fileContents.agents)).toEqual(["claude-code"]);
    });

    it("should convert password to refresh token when password is provided", async () => {
      const config: Config = {
        installDir: tempDir,
        agents: { "claude-code": { profile: { baseProfile: "senior-swe" } } },
        auth: {
          username: "test@example.com",
          password: "testpass",
          organizationUrl: "https://example.com",
        },
      };

      await configLoader.run({ config });

      const configFile = getConfigPath({ installDir: tempDir });
      const fileContents = JSON.parse(fs.readFileSync(configFile, "utf-8"));

      // Should have refreshToken in nested auth, not password
      expect(fileContents.auth.refreshToken).toBe("mock-refresh-token");
      expect(fileContents.auth.password).toBeNull();
      expect(fileContents.auth.username).toBe("test@example.com");
    });

    it("should use existing refresh token when provided instead of password", async () => {
      const config: Config = {
        installDir: tempDir,
        agents: { "claude-code": { profile: { baseProfile: "senior-swe" } } },
        auth: {
          username: "test@example.com",
          refreshToken: "existing-refresh-token",
          organizationUrl: "https://example.com",
        },
      };

      await configLoader.run({ config });

      const configFile = getConfigPath({ installDir: tempDir });
      const fileContents = JSON.parse(fs.readFileSync(configFile, "utf-8"));

      // Should preserve existing refreshToken in nested auth
      expect(fileContents.auth.refreshToken).toBe("existing-refresh-token");
      expect(fileContents.auth.password).toBeNull();
    });
  });

  describe("uninstall", () => {
    it("should remove config file", async () => {
      const config: Config = { installDir: tempDir };
      const configFile = getConfigPath({ installDir: tempDir });

      // Create config file
      fs.writeFileSync(configFile, JSON.stringify({ test: "data" }), "utf-8");

      await configLoader.uninstall({ config });

      expect(fs.existsSync(configFile)).toBe(false);
    });

    it("should handle missing config file gracefully", async () => {
      const config: Config = { installDir: tempDir };

      // Should not throw
      await expect(configLoader.uninstall({ config })).resolves.not.toThrow();
    });

    it("should delete config file when uninstalling the only agent", async () => {
      const configFile = getConfigPath({ installDir: tempDir });
      fs.writeFileSync(
        configFile,
        JSON.stringify({
          installDir: tempDir,
          agents: {
            "claude-code": { profile: { baseProfile: "senior-swe" } },
          },
        }),
        "utf-8",
      );

      // Uninstall claude-code (the only agent)
      const config: Config = {
        installDir: tempDir,
        agents: { "claude-code": {} }, // Agent being uninstalled
      };

      await configLoader.uninstall({ config });

      // Config file should be deleted since no agents remain
      expect(fs.existsSync(configFile)).toBe(false);
    });

    it("should delete config file when uninstalling last agent", async () => {
      const configFile = getConfigPath({ installDir: tempDir });
      fs.writeFileSync(
        configFile,
        JSON.stringify({
          installDir: tempDir,
          agents: {
            "claude-code": { profile: { baseProfile: "senior-swe" } },
          },
        }),
        "utf-8",
      );

      // Uninstall the only agent
      const config: Config = {
        installDir: tempDir,
        agents: { "claude-code": {} }, // Agent being uninstalled
      };

      await configLoader.uninstall({ config });

      // Config file should be deleted
      expect(fs.existsSync(configFile)).toBe(false);
    });

    it("should delete config file when no agents field exists and no profile for backwards compat", async () => {
      const configFile = getConfigPath({ installDir: tempDir });
      fs.writeFileSync(
        configFile,
        JSON.stringify({
          installDir: tempDir,
          // No agents field, no profile (so backwards compat won't create an agent)
        }),
        "utf-8",
      );

      const config: Config = { installDir: tempDir };

      await configLoader.uninstall({ config });

      // Config file should be deleted when there are no agents
      expect(fs.existsSync(configFile)).toBe(false);
    });

    it("should delete config with version when uninstalling last agent", async () => {
      const configFile = getConfigPath({ installDir: tempDir });

      // Create config with version
      fs.writeFileSync(
        configFile,
        JSON.stringify({
          installDir: tempDir,
          agents: {
            "claude-code": { profile: { baseProfile: "senior-swe" } },
          },
          version: "19.0.0",
        }),
        "utf-8",
      );

      // Uninstall the only agent
      const config: Config = {
        installDir: tempDir,
        agents: { "claude-code": {} },
      };

      await configLoader.uninstall({ config });

      // Config file should be deleted (includes version)
      expect(fs.existsSync(configFile)).toBe(false);
    });

    it("should delete config with version when uninstalling last agent", async () => {
      const configFile = getConfigPath({ installDir: tempDir });

      // Create config with version and single agent
      fs.writeFileSync(
        configFile,
        JSON.stringify({
          installDir: tempDir,
          agents: {
            "claude-code": { profile: { baseProfile: "senior-swe" } },
          },
          version: "19.0.0",
        }),
        "utf-8",
      );

      // Uninstall claude-code (the only agent)
      const config: Config = {
        installDir: tempDir,
        agents: { "claude-code": {} },
      };

      await configLoader.uninstall({ config });

      // Config file should be deleted when no agents remain
      expect(fs.existsSync(configFile)).toBe(false);
    });

    it("should delete config when no agents field exists (legacy behavior)", async () => {
      const configFile = getConfigPath({ installDir: tempDir });

      // Create legacy config without agents
      fs.writeFileSync(
        configFile,
        JSON.stringify({
          installDir: tempDir,
          version: "18.0.0",
          // No agents field
        }),
        "utf-8",
      );

      const config: Config = { installDir: tempDir };

      await configLoader.uninstall({ config });

      // Config file should be deleted (legacy behavior)
      expect(fs.existsSync(configFile)).toBe(false);
    });

    it("should delete config when uninstalling claude-code agent", async () => {
      const configFile = getConfigPath({ installDir: tempDir });

      // Create config with claude-code agent
      fs.writeFileSync(
        configFile,
        JSON.stringify({
          installDir: tempDir,
          agents: {
            "claude-code": { profile: { baseProfile: "senior-swe" } },
          },
        }),
        "utf-8",
      );

      // Uninstall claude-code
      const config: Config = {
        installDir: tempDir,
        agents: { "claude-code": {} },
      };

      await configLoader.uninstall({ config });

      // Config file should be deleted when no agents remain
      expect(fs.existsSync(configFile)).toBe(false);
    });
  });
});
