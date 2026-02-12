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

// Mock os.homedir so getConfigPath resolves to test directories
vi.mock("os", async (importOriginal) => {
  const actual = await importOriginal<typeof os>();
  return {
    ...actual,
    homedir: vi.fn().mockReturnValue(actual.homedir()),
  };
});

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
    vi.mocked(os.homedir).mockReturnValue(tempDir);
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

      const configFile = getConfigPath();
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

      const configFile = getConfigPath();
      const fileContents = JSON.parse(fs.readFileSync(configFile, "utf-8"));
      expect(fileContents.sendSessionTranscript).toBe("enabled");
    });

    it("should NOT include sendSessionTranscript when not provided", async () => {
      const config: Config = {
        installDir: tempDir,
        agents: { "claude-code": { profile: { baseProfile: "senior-swe" } } },
      };

      await configLoader.run({ config });

      const configFile = getConfigPath();
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

      const configFile = getConfigPath();
      const fileContents = JSON.parse(fs.readFileSync(configFile, "utf-8"));
      expect(fileContents.sendSessionTranscript).toBe("disabled");
    });

    it("should save agents to config file", async () => {
      const config: Config = {
        installDir: tempDir,
        agents: { "claude-code": { profile: { baseProfile: "senior-swe" } } },
      };

      await configLoader.run({ config });

      const configFile = getConfigPath();
      const fileContents = JSON.parse(fs.readFileSync(configFile, "utf-8"));
      expect(Object.keys(fileContents.agents)).toEqual(["claude-code"]);
    });

    it("should preserve existing agents when updating config", async () => {
      // Create existing config with agents
      const configFile = getConfigPath();
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
      const configFile = getConfigPath();
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

      const configFile = getConfigPath();
      const fileContents = JSON.parse(fs.readFileSync(configFile, "utf-8"));
      expect(fileContents.agents).toEqual({
        "claude-code": {
          profile: { baseProfile: "none" },
        },
      });
    });

    it("should preserve agents field from existing config when not provided in new config", async () => {
      // Create existing config with agents field (e.g., from switchProfile)
      const configFile = getConfigPath();
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

      const configFile = getConfigPath();
      const fileContents = JSON.parse(fs.readFileSync(configFile, "utf-8"));

      // Should have refreshToken in nested auth, not password
      expect(fileContents.auth.refreshToken).toBe("mock-refresh-token");
      expect(fileContents.auth.password).toBeNull();
      expect(fileContents.auth.username).toBe("test@example.com");
    });

    it("should preserve organizations, isAdmin, and transcriptDestination from existing config", async () => {
      // Create existing config with organizations, isAdmin, and transcriptDestination
      const configFile = getConfigPath();
      fs.writeFileSync(
        configFile,
        JSON.stringify({
          installDir: tempDir,
          agents: {
            "claude-code": { profile: { baseProfile: "senior-swe" } },
          },
          auth: {
            username: "test@example.com",
            organizationUrl: "https://example.tilework.tech",
            refreshToken: "existing-token",
            organizations: ["org-alpha", "org-beta"],
            isAdmin: true,
          },
          transcriptDestination: "myorg",
        }),
        "utf-8",
      );

      // Run configLoader with config that has auth but no organizations
      const config: Config = {
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
        auth: {
          username: "test@example.com",
          organizationUrl: "https://example.tilework.tech",
          refreshToken: "existing-token",
        },
      };

      await configLoader.run({ config });

      const fileContents = JSON.parse(fs.readFileSync(configFile, "utf-8"));
      expect(fileContents.auth.organizations).toEqual([
        "org-alpha",
        "org-beta",
      ]);
      expect(fileContents.auth.isAdmin).toBe(true);
      expect(fileContents.transcriptDestination).toBe("myorg");
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

      const configFile = getConfigPath();
      const fileContents = JSON.parse(fs.readFileSync(configFile, "utf-8"));

      // Should preserve existing refreshToken in nested auth
      expect(fileContents.auth.refreshToken).toBe("existing-refresh-token");
      expect(fileContents.auth.password).toBeNull();
    });
  });
});
