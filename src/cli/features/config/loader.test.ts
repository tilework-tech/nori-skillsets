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
        profile: { baseProfile: "senior-swe" },
      };

      await configLoader.run({ config });

      const configFile = getConfigPath({ installDir: tempDir });
      expect(fs.existsSync(configFile)).toBe(true);

      // Verify file contents
      const fileContents = JSON.parse(fs.readFileSync(configFile, "utf-8"));
      expect(fileContents.installDir).toBe(tempDir);
      expect(fileContents.profile).toEqual({ baseProfile: "senior-swe" });
    });

    it("should include sendSessionTranscript: enabled for paid installation", async () => {
      const config: Config = {
        installDir: tempDir,
        profile: { baseProfile: "senior-swe" },
        auth: {
          username: "test@example.com",
          password: "testpass",
          organizationUrl: "https://example.com",
        },
        sendSessionTranscript: "enabled",
      };

      await configLoader.run({ config });

      const configFile = getConfigPath({ installDir: tempDir });
      const fileContents = JSON.parse(fs.readFileSync(configFile, "utf-8"));
      expect(fileContents.sendSessionTranscript).toBe("enabled");
    });

    it("should NOT include sendSessionTranscript for free installation", async () => {
      const config: Config = {
        installDir: tempDir,
        profile: { baseProfile: "senior-swe" },
      };

      await configLoader.run({ config });

      const configFile = getConfigPath({ installDir: tempDir });
      const fileContents = JSON.parse(fs.readFileSync(configFile, "utf-8"));
      expect(fileContents.sendSessionTranscript).toBeUndefined();
    });

    it("should preserve existing sendSessionTranscript preference for paid installation", async () => {
      const config: Config = {
        installDir: tempDir,
        profile: { baseProfile: "senior-swe" },
        auth: {
          username: "test@example.com",
          password: "testpass",
          organizationUrl: "https://example.com",
        },
        sendSessionTranscript: "disabled",
      };

      await configLoader.run({ config });

      const configFile = getConfigPath({ installDir: tempDir });
      const fileContents = JSON.parse(fs.readFileSync(configFile, "utf-8"));
      expect(fileContents.sendSessionTranscript).toBe("disabled");
    });

    it("should save registryAuths to config file", async () => {
      const config: Config = {
        installDir: tempDir,
        profile: { baseProfile: "senior-swe" },
        registryAuths: [
          {
            registryUrl: "https://registry.example.com",
            username: "user@example.com",
            password: "secret123",
          },
        ],
      };

      await configLoader.run({ config });

      const configFile = getConfigPath({ installDir: tempDir });
      const fileContents = JSON.parse(fs.readFileSync(configFile, "utf-8"));
      expect(fileContents.registryAuths).toEqual([
        {
          registryUrl: "https://registry.example.com",
          username: "user@example.com",
          password: "secret123",
        },
      ]);
    });

    it("should preserve existing registryAuths when not provided in new config", async () => {
      // Create existing config with registryAuths
      const configFile = getConfigPath({ installDir: tempDir });
      fs.writeFileSync(
        configFile,
        JSON.stringify({
          installDir: tempDir,
          registryAuths: [
            {
              registryUrl: "https://existing.example.com",
              username: "existing@example.com",
              password: "existingpass",
            },
          ],
        }),
        "utf-8",
      );

      // Run with config that doesn't include registryAuths
      const config: Config = {
        installDir: tempDir,
        profile: { baseProfile: "senior-swe" },
      };

      await configLoader.run({ config });

      const fileContents = JSON.parse(fs.readFileSync(configFile, "utf-8"));
      expect(fileContents.registryAuths).toEqual([
        {
          registryUrl: "https://existing.example.com",
          username: "existing@example.com",
          password: "existingpass",
        },
      ]);
    });

    it("should save agents to config file", async () => {
      const config: Config = {
        installDir: tempDir,
        profile: { baseProfile: "senior-swe" },
        agents: { "claude-code": { profile: { baseProfile: "senior-swe" } } },
      };

      await configLoader.run({ config });

      const configFile = getConfigPath({ installDir: tempDir });
      const fileContents = JSON.parse(fs.readFileSync(configFile, "utf-8"));
      expect(Object.keys(fileContents.agents)).toEqual(["claude-code"]);
    });

    it("should merge agents with existing config", async () => {
      // Create existing config with agents
      const configFile = getConfigPath({ installDir: tempDir });
      fs.writeFileSync(
        configFile,
        JSON.stringify({
          installDir: tempDir,
          profile: { baseProfile: "senior-swe" },
          agents: {
            "claude-code": { profile: { baseProfile: "senior-swe" } },
          },
        }),
        "utf-8",
      );

      // Install another agent
      const config: Config = {
        installDir: tempDir,
        profile: { baseProfile: "senior-swe" },
        agents: {
          "cursor-agent": { profile: { baseProfile: "senior-swe" } },
        },
      };

      await configLoader.run({ config });

      const fileContents = JSON.parse(fs.readFileSync(configFile, "utf-8"));
      expect(Object.keys(fileContents.agents).sort()).toEqual([
        "claude-code",
        "cursor-agent",
      ]);
    });

    it("should not duplicate agents when re-installing", async () => {
      // Create existing config with agents
      const configFile = getConfigPath({ installDir: tempDir });
      fs.writeFileSync(
        configFile,
        JSON.stringify({
          installDir: tempDir,
          profile: { baseProfile: "senior-swe" },
          agents: {
            "claude-code": { profile: { baseProfile: "senior-swe" } },
          },
        }),
        "utf-8",
      );

      // Re-install same agent
      const config: Config = {
        installDir: tempDir,
        profile: { baseProfile: "senior-swe" },
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
        profile: { baseProfile: "senior-swe" },
        agents: {
          "cursor-agent": {
            profile: { baseProfile: "none" },
          },
        },
      };

      await configLoader.run({ config });

      const configFile = getConfigPath({ installDir: tempDir });
      const fileContents = JSON.parse(fs.readFileSync(configFile, "utf-8"));
      expect(fileContents.agents).toEqual({
        "cursor-agent": {
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
          profile: { baseProfile: "amol" },
          agents: {
            "cursor-agent": {
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
        profile: { baseProfile: "amol" },
        agents: {
          "cursor-agent": {},
        },
      };

      await configLoader.run({ config });

      const fileContents = JSON.parse(fs.readFileSync(configFile, "utf-8"));
      // agents field should be merged - new config takes precedence
      expect(Object.keys(fileContents.agents)).toEqual(["cursor-agent"]);
    });

    it("should convert password to refresh token when password is provided", async () => {
      const config: Config = {
        installDir: tempDir,
        profile: { baseProfile: "senior-swe" },
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
        profile: { baseProfile: "senior-swe" },
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

    it("should remove agent from agents and keep config when other agents remain", async () => {
      const configFile = getConfigPath({ installDir: tempDir });
      fs.writeFileSync(
        configFile,
        JSON.stringify({
          installDir: tempDir,
          profile: { baseProfile: "senior-swe" },
          agents: {
            "claude-code": { profile: { baseProfile: "senior-swe" } },
            "cursor-agent": { profile: { baseProfile: "senior-swe" } },
          },
        }),
        "utf-8",
      );

      // Uninstall only cursor-agent
      const config: Config = {
        installDir: tempDir,
        agents: { "cursor-agent": {} }, // Agent being uninstalled
      };

      await configLoader.uninstall({ config });

      // Config file should still exist
      expect(fs.existsSync(configFile)).toBe(true);

      // Should only have claude-code remaining
      const fileContents = JSON.parse(fs.readFileSync(configFile, "utf-8"));
      expect(Object.keys(fileContents.agents)).toEqual(["claude-code"]);
    });

    it("should delete config file when uninstalling last agent", async () => {
      const configFile = getConfigPath({ installDir: tempDir });
      fs.writeFileSync(
        configFile,
        JSON.stringify({
          installDir: tempDir,
          profile: { baseProfile: "senior-swe" },
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
          profile: { baseProfile: "senior-swe" },
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

    it("should preserve version in config when other agents remain", async () => {
      const configFile = getConfigPath({ installDir: tempDir });

      // Create config with version and multiple agents
      fs.writeFileSync(
        configFile,
        JSON.stringify({
          installDir: tempDir,
          profile: { baseProfile: "senior-swe" },
          agents: {
            "claude-code": { profile: { baseProfile: "senior-swe" } },
            "cursor-agent": { profile: { baseProfile: "senior-swe" } },
          },
          version: "19.0.0",
        }),
        "utf-8",
      );

      // Uninstall only cursor-agent
      const config: Config = {
        installDir: tempDir,
        agents: { "cursor-agent": {} },
      };

      await configLoader.uninstall({ config });

      // Config file should still exist with remaining agent
      expect(fs.existsSync(configFile)).toBe(true);
      const fileContents = JSON.parse(fs.readFileSync(configFile, "utf-8"));
      expect(Object.keys(fileContents.agents)).toEqual(["claude-code"]);

      // Version should be preserved in config
      expect(fileContents.version).toBe("19.0.0");
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

    it("should preserve agents field when uninstalling one of multiple agents", async () => {
      const configFile = getConfigPath({ installDir: tempDir });

      // Create config with multiple agents and per-agent profile settings
      fs.writeFileSync(
        configFile,
        JSON.stringify({
          installDir: tempDir,
          profile: { baseProfile: "senior-swe" },
          agents: {
            "claude-code": { profile: { baseProfile: "senior-swe" } },
            "cursor-agent": { profile: { baseProfile: "none" } },
          },
        }),
        "utf-8",
      );

      // Uninstall cursor-agent, leaving claude-code
      const config: Config = {
        installDir: tempDir,
        agents: { "cursor-agent": {} },
      };

      await configLoader.uninstall({ config });

      // Config file should still exist
      expect(fs.existsSync(configFile)).toBe(true);

      const fileContents = JSON.parse(fs.readFileSync(configFile, "utf-8"));

      // agents should only have claude-code (cursor-agent was removed)
      expect(Object.keys(fileContents.agents)).toEqual(["claude-code"]);

      // claude-code agent config should be preserved
      expect(fileContents.agents["claude-code"]).toEqual({
        profile: { baseProfile: "senior-swe" },
      });
    });
  });
});
