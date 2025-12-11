/**
 * Tests for AgentRegistry
 * Tests real behavior: selecting agents by name, listing available agents
 */

import * as fs from "fs/promises";
import { tmpdir } from "os";
import * as path from "path";

import { describe, test, expect, beforeEach, afterEach } from "vitest";

import {
  AgentRegistry,
  type Loader,
  type LoaderRegistry,
  type ValidationResult,
} from "@/cli/features/agentRegistry.js";

describe("AgentRegistry", () => {
  // Reset singleton between tests
  beforeEach(() => {
    AgentRegistry.resetInstance();
  });

  afterEach(() => {
    AgentRegistry.resetInstance();
  });

  describe("getInstance", () => {
    test("returns singleton instance", () => {
      const instance1 = AgentRegistry.getInstance();
      const instance2 = AgentRegistry.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe("get", () => {
    test("returns claude-code agent when requested", () => {
      const registry = AgentRegistry.getInstance();
      const agent = registry.get({ name: "claude-code" });

      expect(agent.name).toBe("claude-code");
      expect(agent.displayName).toBe("Claude Code");
    });

    test("returns cursor-agent when requested", () => {
      const registry = AgentRegistry.getInstance();
      const agent = registry.get({ name: "cursor-agent" });

      expect(agent.name).toBe("cursor-agent");
      expect(agent.displayName).toBe("Cursor Agent");
    });

    test("throws error with helpful message for unknown agent", () => {
      const registry = AgentRegistry.getInstance();

      expect(() => registry.get({ name: "unknown-agent" })).toThrow(
        /Unknown agent 'unknown-agent'\. Available agents:/,
      );
    });

    test("throws error for empty agent name", () => {
      const registry = AgentRegistry.getInstance();

      expect(() => registry.get({ name: "" })).toThrow(/Unknown agent/);
    });
  });

  describe("list", () => {
    test("returns array of agent names", () => {
      const registry = AgentRegistry.getInstance();
      const agents = registry.list();

      expect(agents).toContain("claude-code");
      expect(agents).toContain("cursor-agent");
      expect(agents.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("agent interface", () => {
    test("claude-code agent provides LoaderRegistry", () => {
      const registry = AgentRegistry.getInstance();
      const agent = registry.get({ name: "claude-code" });
      const loaderRegistry: LoaderRegistry = agent.getLoaderRegistry();

      // Verify it has the expected methods
      expect(loaderRegistry.getAll).toBeDefined();
      expect(loaderRegistry.getAllReversed).toBeDefined();

      // Verify it returns loaders
      const loaders = loaderRegistry.getAll();
      expect(loaders.length).toBeGreaterThan(0);
    });

    test("cursor-agent provides LoaderRegistry", () => {
      const registry = AgentRegistry.getInstance();
      const agent = registry.get({ name: "cursor-agent" });
      const loaderRegistry: LoaderRegistry = agent.getLoaderRegistry();

      // Verify it has the expected methods
      expect(loaderRegistry.getAll).toBeDefined();
      expect(loaderRegistry.getAllReversed).toBeDefined();

      // Verify it returns loaders
      const loaders = loaderRegistry.getAll();
      expect(loaders.length).toBeGreaterThan(0);
    });

    test("loaders satisfy the Loader type with required properties", () => {
      const registry = AgentRegistry.getInstance();
      const agent = registry.get({ name: "claude-code" });
      const loaderRegistry = agent.getLoaderRegistry();
      const loaders: Array<Loader> = loaderRegistry.getAll();

      for (const loader of loaders) {
        expect(typeof loader.name).toBe("string");
        expect(typeof loader.description).toBe("string");
        expect(typeof loader.run).toBe("function");
        expect(typeof loader.uninstall).toBe("function");
        // validate is optional
        if (loader.validate != null) {
          expect(typeof loader.validate).toBe("function");
        }
      }
    });

    test("cursor-agent includes config loader", () => {
      const registry = AgentRegistry.getInstance();
      const agent = registry.get({ name: "cursor-agent" });
      const loaderRegistry = agent.getLoaderRegistry();
      const loaders = loaderRegistry.getAll();
      const loaderNames = loaders.map((l) => l.name);

      expect(loaderNames).toContain("config");
    });

    test("both agents include config loader", () => {
      const registry = AgentRegistry.getInstance();

      for (const agentName of ["claude-code", "cursor-agent"]) {
        const agent = registry.get({ name: agentName });
        const loaderRegistry = agent.getLoaderRegistry();
        const loaders = loaderRegistry.getAll();
        const loaderNames = loaders.map((l) => l.name);

        expect(loaderNames).toContain("config");
      }
    });
  });

  describe("shared types", () => {
    test("ValidationResult type has expected shape", () => {
      // This test verifies the type exists and can be used
      const validResult: ValidationResult = {
        valid: true,
        message: "All good",
      };
      expect(validResult.valid).toBe(true);
      expect(validResult.message).toBe("All good");

      const invalidResult: ValidationResult = {
        valid: false,
        message: "Error found",
        errors: ["error 1", "error 2"],
      };
      expect(invalidResult.valid).toBe(false);
      expect(invalidResult.errors).toHaveLength(2);
    });
  });

  describe("claude-code agent listProfiles", () => {
    let testInstallDir: string;

    beforeEach(async () => {
      testInstallDir = await fs.mkdtemp(
        path.join(tmpdir(), "agent-profiles-test-"),
      );
    });

    afterEach(async () => {
      if (testInstallDir) {
        await fs.rm(testInstallDir, { recursive: true, force: true });
      }
    });

    test("returns empty array when no profiles directory exists", async () => {
      const registry = AgentRegistry.getInstance();
      const agent = registry.get({ name: "claude-code" });

      const profiles = await agent.listProfiles({ installDir: testInstallDir });

      expect(profiles).toEqual([]);
    });

    test("returns empty array when profiles directory is empty", async () => {
      const profilesDir = path.join(testInstallDir, ".claude", "profiles");
      await fs.mkdir(profilesDir, { recursive: true });

      const registry = AgentRegistry.getInstance();
      const agent = registry.get({ name: "claude-code" });

      const profiles = await agent.listProfiles({ installDir: testInstallDir });

      expect(profiles).toEqual([]);
    });

    test("returns profile names for directories containing CLAUDE.md", async () => {
      const profilesDir = path.join(testInstallDir, ".claude", "profiles");

      // Create valid profiles (with CLAUDE.md)
      for (const name of ["amol", "senior-swe"]) {
        const dir = path.join(profilesDir, name);
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(path.join(dir, "CLAUDE.md"), `# ${name}`);
      }

      // Create invalid profile (no CLAUDE.md)
      const invalidDir = path.join(profilesDir, "invalid-profile");
      await fs.mkdir(invalidDir, { recursive: true });
      await fs.writeFile(path.join(invalidDir, "readme.txt"), "not a profile");

      const registry = AgentRegistry.getInstance();
      const agent = registry.get({ name: "claude-code" });

      const profiles = await agent.listProfiles({ installDir: testInstallDir });

      expect(profiles).toContain("amol");
      expect(profiles).toContain("senior-swe");
      expect(profiles).not.toContain("invalid-profile");
      expect(profiles.length).toBe(2);
    });
  });

  describe("claude-code agent listSourceProfiles", () => {
    test("returns profiles from package source directory", async () => {
      const registry = AgentRegistry.getInstance();
      const agent = registry.get({ name: "claude-code" });

      const profiles = await agent.listSourceProfiles();

      // Should return multiple profiles from claude-code/profiles/config/
      expect(profiles.length).toBeGreaterThan(0);

      // Should include known profiles like amol, senior-swe
      const profileNames = profiles.map((p) => p.name);
      expect(profileNames).toContain("amol");
    });

    test("returns profiles with name and description", async () => {
      const registry = AgentRegistry.getInstance();
      const agent = registry.get({ name: "claude-code" });

      const profiles = await agent.listSourceProfiles();

      for (const profile of profiles) {
        expect(profile.name).toBeDefined();
        expect(profile.name.length).toBeGreaterThan(0);
        expect(profile.description).toBeDefined();
        expect(profile.description.length).toBeGreaterThan(0);
      }
    });

    test("excludes directories starting with underscore", async () => {
      const registry = AgentRegistry.getInstance();
      const agent = registry.get({ name: "claude-code" });

      const profiles = await agent.listSourceProfiles();
      const names = profiles.map((p) => p.name);

      for (const name of names) {
        expect(name.startsWith("_")).toBe(false);
      }
    });

    test("returns profiles sorted alphabetically", async () => {
      const registry = AgentRegistry.getInstance();
      const agent = registry.get({ name: "claude-code" });

      const profiles = await agent.listSourceProfiles();
      const names = profiles.map((p) => p.name);
      const sortedNames = [...names].sort();

      expect(names).toEqual(sortedNames);
    });
  });

  describe("cursor-agent listSourceProfiles", () => {
    test("returns profiles from package source directory", async () => {
      const registry = AgentRegistry.getInstance();
      const agent = registry.get({ name: "cursor-agent" });

      const profiles = await agent.listSourceProfiles();

      // Should return at least one profile (amol) from cursor-agent/profiles/config/
      expect(profiles.length).toBeGreaterThan(0);

      const profileNames = profiles.map((p) => p.name);
      expect(profileNames).toContain("amol");
    });

    test("returns profiles with name and description", async () => {
      const registry = AgentRegistry.getInstance();
      const agent = registry.get({ name: "cursor-agent" });

      const profiles = await agent.listSourceProfiles();

      for (const profile of profiles) {
        expect(profile.name).toBeDefined();
        expect(profile.name.length).toBeGreaterThan(0);
        expect(profile.description).toBeDefined();
        expect(profile.description.length).toBeGreaterThan(0);
      }
    });
  });

  describe("claude-code agent switchProfile", () => {
    let testInstallDir: string;

    beforeEach(async () => {
      testInstallDir = await fs.mkdtemp(
        path.join(tmpdir(), "agent-switch-test-"),
      );
    });

    afterEach(async () => {
      if (testInstallDir) {
        await fs.rm(testInstallDir, { recursive: true, force: true });
      }
    });

    test("updates config with new profile", async () => {
      // Create profiles directory with test profile
      const profilesDir = path.join(testInstallDir, ".claude", "profiles");
      const profileDir = path.join(profilesDir, "test-profile");
      await fs.mkdir(profileDir, { recursive: true });
      await fs.writeFile(path.join(profileDir, "CLAUDE.md"), "# Test Profile");

      // Create initial config
      const configPath = path.join(testInstallDir, ".nori-config.json");
      await fs.writeFile(
        configPath,
        JSON.stringify({ profile: { baseProfile: "old-profile" } }),
      );

      const registry = AgentRegistry.getInstance();
      const agent = registry.get({ name: "claude-code" });

      await agent.switchProfile({
        installDir: testInstallDir,
        profileName: "test-profile",
      });

      // Verify config was updated
      const updatedConfig = JSON.parse(await fs.readFile(configPath, "utf-8"));
      expect(updatedConfig.agents?.["claude-code"]?.profile?.baseProfile).toBe(
        "test-profile",
      );
    });

    test("preserves existing config fields when switching", async () => {
      // Create profiles directory with test profile
      const profilesDir = path.join(testInstallDir, ".claude", "profiles");
      const profileDir = path.join(profilesDir, "new-profile");
      await fs.mkdir(profileDir, { recursive: true });
      await fs.writeFile(path.join(profileDir, "CLAUDE.md"), "# New Profile");

      // Create initial config with auth and other fields
      const configPath = path.join(testInstallDir, ".nori-config.json");
      await fs.writeFile(
        configPath,
        JSON.stringify({
          username: "test@example.com",
          password: "secret",
          organizationUrl: "https://org.example.com",
          profile: { baseProfile: "old-profile" },
          sendSessionTranscript: "enabled",
          registryAuths: [
            {
              username: "reg-user",
              password: "reg-pass",
              registryUrl: "https://registry.example.com",
            },
          ],
        }),
      );

      const registry = AgentRegistry.getInstance();
      const agent = registry.get({ name: "claude-code" });

      await agent.switchProfile({
        installDir: testInstallDir,
        profileName: "new-profile",
      });

      // Verify all fields preserved
      const updatedConfig = JSON.parse(await fs.readFile(configPath, "utf-8"));
      expect(updatedConfig.username).toBe("test@example.com");
      expect(updatedConfig.password).toBe("secret");
      expect(updatedConfig.organizationUrl).toBe("https://org.example.com");
      expect(updatedConfig.sendSessionTranscript).toBe("enabled");
      expect(updatedConfig.registryAuths).toEqual([
        {
          username: "reg-user",
          password: "reg-pass",
          registryUrl: "https://registry.example.com",
        },
      ]);
      expect(updatedConfig.agents?.["claude-code"]?.profile?.baseProfile).toBe(
        "new-profile",
      );
    });

    test("throws error for non-existent profile", async () => {
      // Create profiles directory but no profiles
      const profilesDir = path.join(testInstallDir, ".claude", "profiles");
      await fs.mkdir(profilesDir, { recursive: true });

      const registry = AgentRegistry.getInstance();
      const agent = registry.get({ name: "claude-code" });

      await expect(
        agent.switchProfile({
          installDir: testInstallDir,
          profileName: "non-existent",
        }),
      ).rejects.toThrow(/Profile "non-existent" not found/);
    });
  });
});
