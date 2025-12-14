/**
 * Tests for cursor-agent agent implementation
 */

import * as fs from "fs/promises";
import { tmpdir } from "os";
import * as path from "path";

import { describe, test, expect, beforeEach, afterEach } from "vitest";

import { cursorAgent } from "@/cli/features/cursor-agent/agent.js";

describe("cursorAgent", () => {
  describe("agent metadata", () => {
    test("has correct name", () => {
      expect(cursorAgent.name).toBe("cursor-agent");
    });

    test("has correct displayName", () => {
      expect(cursorAgent.displayName).toBe("Cursor Agent");
    });
  });

  describe("getLoaderRegistry", () => {
    test("returns CursorLoaderRegistry", () => {
      const registry = cursorAgent.getLoaderRegistry();

      expect(registry.getAll).toBeDefined();
      expect(registry.getAllReversed).toBeDefined();
    });

    test("registry has loaders", () => {
      const registry = cursorAgent.getLoaderRegistry();
      const loaders = registry.getAll();

      expect(loaders.length).toBeGreaterThan(0);
    });
  });

  describe("getGlobalLoaders", () => {
    test("returns hooks and slashcommands with human-readable names", () => {
      const globalLoaders = cursorAgent.getGlobalLoaders();

      expect(globalLoaders).toEqual([
        { name: "hooks", humanReadableName: "hooks" },
        { name: "slashcommands", humanReadableName: "slash commands" },
      ]);
    });
  });

  describe("listProfiles", () => {
    let testInstallDir: string;

    beforeEach(async () => {
      testInstallDir = await fs.mkdtemp(
        path.join(tmpdir(), "cursor-agent-profiles-test-"),
      );
    });

    afterEach(async () => {
      if (testInstallDir) {
        await fs.rm(testInstallDir, { recursive: true, force: true });
      }
    });

    test("returns empty array when no profiles directory exists", async () => {
      const profiles = await cursorAgent.listProfiles({
        installDir: testInstallDir,
      });

      expect(profiles).toEqual([]);
    });

    test("returns empty array when profiles directory is empty", async () => {
      const profilesDir = path.join(testInstallDir, ".cursor", "profiles");
      await fs.mkdir(profilesDir, { recursive: true });

      const profiles = await cursorAgent.listProfiles({
        installDir: testInstallDir,
      });

      expect(profiles).toEqual([]);
    });

    test("returns profile names for directories containing AGENTS.md", async () => {
      const profilesDir = path.join(testInstallDir, ".cursor", "profiles");

      // Create valid profile with AGENTS.md
      const amolDir = path.join(profilesDir, "amol");
      await fs.mkdir(amolDir, { recursive: true });
      await fs.writeFile(path.join(amolDir, "AGENTS.md"), "# Amol Profile");

      // Create invalid profile without AGENTS.md
      const invalidDir = path.join(profilesDir, "invalid");
      await fs.mkdir(invalidDir, { recursive: true });
      await fs.writeFile(path.join(invalidDir, "readme.txt"), "not a profile");

      const profiles = await cursorAgent.listProfiles({
        installDir: testInstallDir,
      });

      expect(profiles).toContain("amol");
      expect(profiles).not.toContain("invalid");
      expect(profiles.length).toBe(1);
    });

    test("returns profiles sorted alphabetically", async () => {
      const profilesDir = path.join(testInstallDir, ".cursor", "profiles");

      for (const name of ["zebra", "amol", "beta"]) {
        const dir = path.join(profilesDir, name);
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(path.join(dir, "AGENTS.md"), `# ${name}`);
      }

      const profiles = await cursorAgent.listProfiles({
        installDir: testInstallDir,
      });

      expect(profiles).toEqual(["amol", "beta", "zebra"]);
    });
  });

  describe("listSourceProfiles", () => {
    test("returns profiles from package source directory", async () => {
      const profiles = await cursorAgent.listSourceProfiles();

      // Should return at least the amol profile that exists in cursor-agent/profiles/config/
      expect(profiles.length).toBeGreaterThan(0);

      const amolProfile = profiles.find((p) => p.name === "amol");
      expect(amolProfile).toBeDefined();
      expect(amolProfile?.description).toBeDefined();
      expect(amolProfile?.description.length).toBeGreaterThan(0);
    });

    test("returns profiles sorted alphabetically by name", async () => {
      const profiles = await cursorAgent.listSourceProfiles();
      const names = profiles.map((p) => p.name);
      const sortedNames = [...names].sort();

      expect(names).toEqual(sortedNames);
    });

    test("excludes directories starting with underscore", async () => {
      const profiles = await cursorAgent.listSourceProfiles();
      const names = profiles.map((p) => p.name);

      // No profile name should start with underscore (internal/mixin directories)
      for (const name of names) {
        expect(name.startsWith("_")).toBe(false);
      }
    });
  });

  describe("switchProfile", () => {
    let testInstallDir: string;

    beforeEach(async () => {
      testInstallDir = await fs.mkdtemp(
        path.join(tmpdir(), "cursor-agent-switch-test-"),
      );
    });

    afterEach(async () => {
      if (testInstallDir) {
        await fs.rm(testInstallDir, { recursive: true, force: true });
      }
    });

    test("updates config with new profile for cursor-agent", async () => {
      // Create profile directory with AGENTS.md
      const profilesDir = path.join(testInstallDir, ".cursor", "profiles");
      const profileDir = path.join(profilesDir, "test-profile");
      await fs.mkdir(profileDir, { recursive: true });
      await fs.writeFile(path.join(profileDir, "AGENTS.md"), "# Test Profile");

      // Create initial config
      const configPath = path.join(testInstallDir, ".nori-config.json");
      await fs.writeFile(configPath, JSON.stringify({}));

      await cursorAgent.switchProfile({
        installDir: testInstallDir,
        profileName: "test-profile",
      });

      const updatedConfig = JSON.parse(await fs.readFile(configPath, "utf-8"));
      expect(updatedConfig.agents?.["cursor-agent"]?.profile?.baseProfile).toBe(
        "test-profile",
      );
    });

    test("throws error for non-existent profile", async () => {
      // Create profiles directory but no profiles
      const profilesDir = path.join(testInstallDir, ".cursor", "profiles");
      await fs.mkdir(profilesDir, { recursive: true });

      await expect(
        cursorAgent.switchProfile({
          installDir: testInstallDir,
          profileName: "non-existent",
        }),
      ).rejects.toThrow(/Profile "non-existent" not found/);
    });

    test("preserves existing config fields", async () => {
      // Create profile directory
      const profilesDir = path.join(testInstallDir, ".cursor", "profiles");
      const profileDir = path.join(profilesDir, "new-profile");
      await fs.mkdir(profileDir, { recursive: true });
      await fs.writeFile(path.join(profileDir, "AGENTS.md"), "# New Profile");

      // Create initial config with various fields
      // Note: username, password, organizationUrl must all be present for auth to be loaded
      const configPath = path.join(testInstallDir, ".nori-config.json");
      await fs.writeFile(
        configPath,
        JSON.stringify({
          username: "test@example.com",
          password: "secret",
          organizationUrl: "https://org.example.com",
          agents: {
            "claude-code": {
              profile: { baseProfile: "senior-swe" },
            },
          },
        }),
      );

      await cursorAgent.switchProfile({
        installDir: testInstallDir,
        profileName: "new-profile",
      });

      const updatedConfig = JSON.parse(await fs.readFile(configPath, "utf-8"));

      // Verify other fields preserved (auth is now in nested format after save)
      expect(updatedConfig.auth.username).toBe("test@example.com");
      expect(updatedConfig.auth.password).toBe("secret");
      expect(updatedConfig.auth.organizationUrl).toBe(
        "https://org.example.com",
      );

      // Verify claude-code agent config preserved
      expect(updatedConfig.agents?.["claude-code"]?.profile?.baseProfile).toBe(
        "senior-swe",
      );

      // Verify cursor-agent updated
      expect(updatedConfig.agents?.["cursor-agent"]?.profile?.baseProfile).toBe(
        "new-profile",
      );
    });

    test("only updates cursor-agent, does not add other agents", async () => {
      // Create profile directory
      const profilesDir = path.join(testInstallDir, ".cursor", "profiles");
      const profileDir = path.join(profilesDir, "new-profile");
      await fs.mkdir(profileDir, { recursive: true });
      await fs.writeFile(path.join(profileDir, "AGENTS.md"), "# New Profile");

      // Create config with only cursor-agent
      const configPath = path.join(testInstallDir, ".nori-config.json");
      await fs.writeFile(
        configPath,
        JSON.stringify({
          agents: {
            "cursor-agent": { profile: { baseProfile: "amol" } },
          },
          installDir: testInstallDir,
        }),
      );

      await cursorAgent.switchProfile({
        installDir: testInstallDir,
        profileName: "new-profile",
      });

      const updatedConfig = JSON.parse(await fs.readFile(configPath, "utf-8"));

      // Verify cursor-agent is updated
      expect(updatedConfig.agents?.["cursor-agent"]?.profile?.baseProfile).toBe(
        "new-profile",
      );

      // Verify claude-code is NOT added (it wasn't in agents)
      expect(updatedConfig.agents?.["claude-code"]).toBeUndefined();
    });

    test("preserves config for other installed agents", async () => {
      // Create profile directory
      const profilesDir = path.join(testInstallDir, ".cursor", "profiles");
      const profileDir = path.join(profilesDir, "new-profile");
      await fs.mkdir(profileDir, { recursive: true });
      await fs.writeFile(path.join(profileDir, "AGENTS.md"), "# New Profile");

      // Create config with both agents in agents object (keys = installed agents)
      const configPath = path.join(testInstallDir, ".nori-config.json");
      await fs.writeFile(
        configPath,
        JSON.stringify({
          agents: {
            "claude-code": { profile: { baseProfile: "senior-swe" } },
            "cursor-agent": { profile: { baseProfile: "amol" } },
          },
          installDir: testInstallDir,
        }),
      );

      await cursorAgent.switchProfile({
        installDir: testInstallDir,
        profileName: "new-profile",
      });

      const updatedConfig = JSON.parse(await fs.readFile(configPath, "utf-8"));

      // Verify cursor-agent is updated
      expect(updatedConfig.agents?.["cursor-agent"]?.profile?.baseProfile).toBe(
        "new-profile",
      );

      // Verify claude-code is preserved (it's in the agents object)
      expect(updatedConfig.agents?.["claude-code"]?.profile?.baseProfile).toBe(
        "senior-swe",
      );
    });

    test("preserves agents object structure", async () => {
      // Create profile directory
      const profilesDir = path.join(testInstallDir, ".cursor", "profiles");
      const profileDir = path.join(profilesDir, "new-profile");
      await fs.mkdir(profileDir, { recursive: true });
      await fs.writeFile(path.join(profileDir, "AGENTS.md"), "# New Profile");

      // Create config with agents (agents keys = installed agents)
      const configPath = path.join(testInstallDir, ".nori-config.json");
      await fs.writeFile(
        configPath,
        JSON.stringify({
          agents: {
            "cursor-agent": { profile: { baseProfile: "amol" } },
          },
          installDir: testInstallDir,
        }),
      );

      await cursorAgent.switchProfile({
        installDir: testInstallDir,
        profileName: "new-profile",
      });

      const updatedConfig = JSON.parse(await fs.readFile(configPath, "utf-8"));

      // Verify agents structure is preserved (keys indicate installed agents)
      expect(Object.keys(updatedConfig.agents)).toEqual(["cursor-agent"]);
    });
  });
});
