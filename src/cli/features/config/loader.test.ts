/**
 * Tests for config loader
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { getConfigPath } from "@/cli/config.js";

import type { Config } from "@/cli/config.js";

import { configLoader } from "./loader.js";

describe("configLoader", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "config-loader-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
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

    it("should save installedAgents to config file", async () => {
      const config: Config = {
        installDir: tempDir,
        profile: { baseProfile: "senior-swe" },
        installedAgents: ["claude-code"],
      };

      await configLoader.run({ config });

      const configFile = getConfigPath({ installDir: tempDir });
      const fileContents = JSON.parse(fs.readFileSync(configFile, "utf-8"));
      expect(fileContents.installedAgents).toEqual(["claude-code"]);
    });

    it("should merge and dedupe installedAgents with existing config", async () => {
      // Create existing config with installedAgents
      const configFile = getConfigPath({ installDir: tempDir });
      fs.writeFileSync(
        configFile,
        JSON.stringify({
          installDir: tempDir,
          profile: { baseProfile: "senior-swe" },
          installedAgents: ["claude-code"],
        }),
        "utf-8",
      );

      // Install another agent
      const config: Config = {
        installDir: tempDir,
        profile: { baseProfile: "senior-swe" },
        installedAgents: ["cursor-agent"],
      };

      await configLoader.run({ config });

      const fileContents = JSON.parse(fs.readFileSync(configFile, "utf-8"));
      expect(fileContents.installedAgents).toEqual([
        "claude-code",
        "cursor-agent",
      ]);
    });

    it("should not add duplicate agents when re-installing", async () => {
      // Create existing config with installedAgents
      const configFile = getConfigPath({ installDir: tempDir });
      fs.writeFileSync(
        configFile,
        JSON.stringify({
          installDir: tempDir,
          profile: { baseProfile: "senior-swe" },
          installedAgents: ["claude-code"],
        }),
        "utf-8",
      );

      // Re-install same agent
      const config: Config = {
        installDir: tempDir,
        profile: { baseProfile: "senior-swe" },
        installedAgents: ["claude-code"],
      };

      await configLoader.run({ config });

      const fileContents = JSON.parse(fs.readFileSync(configFile, "utf-8"));
      expect(fileContents.installedAgents).toEqual(["claude-code"]);
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

    it("should remove agent from installedAgents and keep config when other agents remain", async () => {
      const configFile = getConfigPath({ installDir: tempDir });
      fs.writeFileSync(
        configFile,
        JSON.stringify({
          installDir: tempDir,
          profile: { baseProfile: "senior-swe" },
          installedAgents: ["claude-code", "cursor-agent"],
        }),
        "utf-8",
      );

      // Uninstall only cursor-agent
      const config: Config = {
        installDir: tempDir,
        installedAgents: ["cursor-agent"], // Agent being uninstalled
      };

      await configLoader.uninstall({ config });

      // Config file should still exist
      expect(fs.existsSync(configFile)).toBe(true);

      // Should only have claude-code remaining
      const fileContents = JSON.parse(fs.readFileSync(configFile, "utf-8"));
      expect(fileContents.installedAgents).toEqual(["claude-code"]);
    });

    it("should delete config file when uninstalling last agent", async () => {
      const configFile = getConfigPath({ installDir: tempDir });
      fs.writeFileSync(
        configFile,
        JSON.stringify({
          installDir: tempDir,
          profile: { baseProfile: "senior-swe" },
          installedAgents: ["claude-code"],
        }),
        "utf-8",
      );

      // Uninstall the only agent
      const config: Config = {
        installDir: tempDir,
        installedAgents: ["claude-code"], // Agent being uninstalled
      };

      await configLoader.uninstall({ config });

      // Config file should be deleted
      expect(fs.existsSync(configFile)).toBe(false);
    });

    it("should delete config file when no installedAgents field exists (legacy behavior)", async () => {
      const configFile = getConfigPath({ installDir: tempDir });
      fs.writeFileSync(
        configFile,
        JSON.stringify({
          installDir: tempDir,
          profile: { baseProfile: "senior-swe" },
          // No installedAgents field
        }),
        "utf-8",
      );

      const config: Config = { installDir: tempDir };

      await configLoader.uninstall({ config });

      // Config file should be deleted (legacy behavior)
      expect(fs.existsSync(configFile)).toBe(false);
    });
  });
});
