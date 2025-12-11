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
  });
});
