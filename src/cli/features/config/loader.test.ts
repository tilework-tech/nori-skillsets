/**
 * Tests for config loader
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import * as clack from "@clack/prompts";
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

// Mock @clack/prompts for UI output assertions
vi.mock("@clack/prompts", () => ({
  log: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    step: vi.fn(),
    message: vi.fn(),
  },
  note: vi.fn(),
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
        activeSkillset: "senior-swe",
      };

      await configLoader.run({ config });

      const configFile = getConfigPath();
      expect(fs.existsSync(configFile)).toBe(true);

      // Verify file contents
      const fileContents = JSON.parse(fs.readFileSync(configFile, "utf-8"));
      expect(fileContents.installDir).toBe(tempDir);
      expect(fileContents.activeSkillset).toBe("senior-swe");
    });

    it("should include sendSessionTranscript when provided", async () => {
      const config: Config = {
        installDir: tempDir,
        activeSkillset: "senior-swe",
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
        activeSkillset: "senior-swe",
      };

      await configLoader.run({ config });

      const configFile = getConfigPath();
      const fileContents = JSON.parse(fs.readFileSync(configFile, "utf-8"));
      expect(fileContents.sendSessionTranscript).toBeUndefined();
    });

    it("should preserve existing sendSessionTranscript preference", async () => {
      const config: Config = {
        installDir: tempDir,
        activeSkillset: "senior-swe",
        sendSessionTranscript: "disabled",
      };

      await configLoader.run({ config });

      const configFile = getConfigPath();
      const fileContents = JSON.parse(fs.readFileSync(configFile, "utf-8"));
      expect(fileContents.sendSessionTranscript).toBe("disabled");
    });

    it("should save activeSkillset to config file", async () => {
      const config: Config = {
        installDir: tempDir,
        activeSkillset: "senior-swe",
      };

      await configLoader.run({ config });

      const configFile = getConfigPath();
      const fileContents = JSON.parse(fs.readFileSync(configFile, "utf-8"));
      expect(fileContents.activeSkillset).toBe("senior-swe");
    });

    it("should preserve existing activeSkillset when updating config", async () => {
      // Create existing config with agents
      const configFile = getConfigPath();
      fs.writeFileSync(
        configFile,
        JSON.stringify({
          installDir: tempDir,
          activeSkillset: "senior-swe",
        }),
        "utf-8",
      );

      // Update the same agent
      const config: Config = {
        installDir: tempDir,
        activeSkillset: "documenter",
      };

      await configLoader.run({ config });

      const fileContents = JSON.parse(fs.readFileSync(configFile, "utf-8"));
      expect(fileContents.activeSkillset).toBe("documenter");
    });

    it("should not duplicate activeSkillset when re-installing", async () => {
      // Create existing config with agents
      const configFile = getConfigPath();
      fs.writeFileSync(
        configFile,
        JSON.stringify({
          installDir: tempDir,
          activeSkillset: "senior-swe",
        }),
        "utf-8",
      );

      // Re-install same agent
      const config: Config = {
        installDir: tempDir,
        activeSkillset: "senior-swe",
      };

      await configLoader.run({ config });

      const fileContents = JSON.parse(fs.readFileSync(configFile, "utf-8"));
      expect(fileContents.activeSkillset).toBe("senior-swe");
    });

    it("should save activeSkillset field to config file", async () => {
      const config: Config = {
        installDir: tempDir,
        activeSkillset: "none",
      };

      await configLoader.run({ config });

      const configFile = getConfigPath();
      const fileContents = JSON.parse(fs.readFileSync(configFile, "utf-8"));
      expect(fileContents.activeSkillset).toBe("none");
    });

    it("should preserve activeSkillset from existing config when not provided in new config", async () => {
      // Create existing config with activeSkillset (e.g., from switchSkillset)
      const configFile = getConfigPath();
      fs.writeFileSync(
        configFile,
        JSON.stringify({
          installDir: tempDir,
          activeSkillset: "none",
        }),
        "utf-8",
      );

      // Run configLoader with config that doesn't explicitly set activeSkillset
      // (simulating what noninteractive install does after switchSkillset)
      const config: Config = {
        installDir: tempDir,
      };

      await configLoader.run({ config });

      const fileContents = JSON.parse(fs.readFileSync(configFile, "utf-8"));
      // activeSkillset should be preserved from existing config
      expect(fileContents.activeSkillset).toBe("none");
    });

    it("should convert password to refresh token when password is provided", async () => {
      const config: Config = {
        installDir: tempDir,
        activeSkillset: "senior-swe",
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
          activeSkillset: "senior-swe",
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
        activeSkillset: "senior-swe",
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

    it("should display auth failure details as a boxed note with email and error code", async () => {
      // Make signInWithEmailAndPassword reject with an auth error
      const { signInWithEmailAndPassword } = await import("firebase/auth");
      vi.mocked(signInWithEmailAndPassword).mockRejectedValueOnce({
        code: "auth/invalid-credential",
        message: "Invalid credential",
      });

      const config: Config = {
        installDir: tempDir,
        activeSkillset: "senior-swe",
        auth: {
          username: "test@example.com",
          password: "wrongpass",
          organizationUrl: "https://example.com",
        },
      };

      await configLoader.run({ config });

      // The auth failure header should use log.error
      expect(clack.log.error).toHaveBeenCalledWith("Authentication failed");

      // Detail lines (email, error code, message, hint) should be in a note()
      expect(clack.note).toHaveBeenCalledWith(
        expect.stringContaining("test@example.com"),
        expect.any(String),
      );
      expect(clack.note).toHaveBeenCalledWith(
        expect.stringContaining("auth/invalid-credential"),
        expect.any(String),
      );

      // Continuation warning should use log.warn
      expect(clack.log.warn).toHaveBeenCalledWith(
        expect.stringContaining("Continuing installation"),
      );
    });

    it("should preserve existing installDir from config instead of overwriting", async () => {
      // Create existing config with a user-configured installDir
      const configFile = getConfigPath();
      fs.writeFileSync(
        configFile,
        JSON.stringify({
          installDir: "/user/configured/path",
          activeSkillset: "senior-swe",
        }),
        "utf-8",
      );

      // Run configLoader with a different installDir (e.g., from switch command)
      const config: Config = {
        installDir: "/some/other/path",
        activeSkillset: "senior-swe",
      };

      await configLoader.run({ config });

      const fileContents = JSON.parse(fs.readFileSync(configFile, "utf-8"));
      // installDir should be preserved from existing config, not overwritten
      expect(fileContents.installDir).toBe("/user/configured/path");
    });

    it("should preserve existing defaultAgents from config instead of overwriting", async () => {
      // Create existing config with a user-configured defaultAgents
      const configFile = getConfigPath();
      fs.writeFileSync(
        configFile,
        JSON.stringify({
          installDir: tempDir,
          defaultAgents: ["claude-code"],
          activeSkillset: "senior-swe",
        }),
        "utf-8",
      );

      // Run configLoader with config that doesn't set defaultAgents
      const config: Config = {
        installDir: tempDir,
        activeSkillset: "senior-swe",
      };

      await configLoader.run({ config });

      const fileContents = JSON.parse(fs.readFileSync(configFile, "utf-8"));
      // defaultAgents should be preserved from existing config
      expect(fileContents.defaultAgents).toEqual(["claude-code"]);
    });

    it("should use incoming installDir when no existing config exists", async () => {
      const config: Config = {
        installDir: "/fresh/install/path",
        activeSkillset: "senior-swe",
      };

      await configLoader.run({ config });

      const configFile = getConfigPath();
      const fileContents = JSON.parse(fs.readFileSync(configFile, "utf-8"));
      // No existing config, so incoming installDir should be used
      expect(fileContents.installDir).toBe("/fresh/install/path");
    });

    it("should use existing refresh token when provided instead of password", async () => {
      const config: Config = {
        installDir: tempDir,
        activeSkillset: "senior-swe",
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
