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
} from "@/cli/features/agentRegistry.js";

describe("AgentRegistry", () => {
  // Reset singleton between tests
  beforeEach(() => {
    AgentRegistry.resetInstance();
  });

  afterEach(() => {
    AgentRegistry.resetInstance();
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

  describe("agent name as UID", () => {
    test("agent.name matches the registry key used to look it up", () => {
      const registry = AgentRegistry.getInstance();
      const agentNames = registry.list();

      for (const name of agentNames) {
        const agent = registry.get({ name });
        expect(agent.name).toBe(name);
      }
    });

    test("round-trip: get(agent.name) returns the same agent", () => {
      const registry = AgentRegistry.getInstance();
      const agentNames = registry.list();

      for (const name of agentNames) {
        const agent = registry.get({ name });
        const roundTrip = registry.get({ name: agent.name });
        expect(roundTrip).toBe(agent);
      }
    });
  });

  describe("agent interface", () => {
    test("claude-code agent returns global loaders with human-readable names", () => {
      const registry = AgentRegistry.getInstance();
      const agent = registry.get({ name: "claude-code" });

      const globalLoaders = agent.getGlobalLoaders();

      // All loaders that write to ~/.claude/ (global config) must be included
      // so they are preserved when uninstalling from subdirectories
      expect(globalLoaders).toEqual([
        { name: "hooks", humanReadableName: "hooks" },
        { name: "statusline", humanReadableName: "statusline" },
        { name: "slashcommands", humanReadableName: "global slash commands" },
        { name: "announcements", humanReadableName: "announcements" },
      ]);
    });

    test("cursor-agent returns global loaders (hooks and slashcommands, no statusline)", () => {
      const registry = AgentRegistry.getInstance();
      const agent = registry.get({ name: "cursor-agent" });

      const globalLoaders = agent.getGlobalLoaders();

      expect(globalLoaders).toEqual([
        { name: "hooks", humanReadableName: "hooks" },
        { name: "slashcommands", humanReadableName: "slash commands" },
      ]);
    });

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
      const profilesDir = path.join(testInstallDir, ".nori", "profiles");
      await fs.mkdir(profilesDir, { recursive: true });

      const registry = AgentRegistry.getInstance();
      const agent = registry.get({ name: "claude-code" });

      const profiles = await agent.listProfiles({ installDir: testInstallDir });

      expect(profiles).toEqual([]);
    });

    test("returns profile names for directories containing CLAUDE.md", async () => {
      const profilesDir = path.join(testInstallDir, ".nori", "profiles");

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

    test("returns namespaced profiles in nested directories", async () => {
      const profilesDir = path.join(testInstallDir, ".nori", "profiles");

      // Create flat profile (e.g., profiles/amol)
      const flatDir = path.join(profilesDir, "amol");
      await fs.mkdir(flatDir, { recursive: true });
      await fs.writeFile(path.join(flatDir, "CLAUDE.md"), "# amol");

      // Create org directory with nested profiles (e.g., profiles/myorg/my-profile)
      const orgDir = path.join(profilesDir, "myorg");
      const nestedProfile1 = path.join(orgDir, "my-profile");
      const nestedProfile2 = path.join(orgDir, "other-profile");
      await fs.mkdir(nestedProfile1, { recursive: true });
      await fs.mkdir(nestedProfile2, { recursive: true });
      await fs.writeFile(
        path.join(nestedProfile1, "CLAUDE.md"),
        "# myorg/my-profile",
      );
      await fs.writeFile(
        path.join(nestedProfile2, "CLAUDE.md"),
        "# myorg/other-profile",
      );

      const registry = AgentRegistry.getInstance();
      const agent = registry.get({ name: "claude-code" });

      const profiles = await agent.listProfiles({ installDir: testInstallDir });

      expect(profiles).toContain("amol");
      expect(profiles).toContain("myorg/my-profile");
      expect(profiles).toContain("myorg/other-profile");
      expect(profiles.length).toBe(3);
    });

    test("org directory without CLAUDE.md is treated as org, not profile", async () => {
      const profilesDir = path.join(testInstallDir, ".nori", "profiles");

      // Create org directory without CLAUDE.md but with nested profile
      const orgDir = path.join(profilesDir, "myorg");
      const nestedProfile = path.join(orgDir, "my-profile");
      await fs.mkdir(nestedProfile, { recursive: true });
      await fs.writeFile(
        path.join(nestedProfile, "CLAUDE.md"),
        "# myorg/my-profile",
      );

      // Also create readme.txt in org dir to simulate a non-profile directory
      await fs.writeFile(path.join(orgDir, "readme.txt"), "org readme");

      const registry = AgentRegistry.getInstance();
      const agent = registry.get({ name: "claude-code" });

      const profiles = await agent.listProfiles({ installDir: testInstallDir });

      // Should only include the nested profile, not the org directory itself
      expect(profiles).toContain("myorg/my-profile");
      expect(profiles).not.toContain("myorg");
      expect(profiles.length).toBe(1);
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
      const profilesDir = path.join(testInstallDir, ".nori", "profiles");
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
      const profilesDir = path.join(testInstallDir, ".nori", "profiles");
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
        }),
      );

      const registry = AgentRegistry.getInstance();
      const agent = registry.get({ name: "claude-code" });

      await agent.switchProfile({
        installDir: testInstallDir,
        profileName: "new-profile",
      });

      // Verify all fields preserved (auth is now in nested format after save)
      const updatedConfig = JSON.parse(await fs.readFile(configPath, "utf-8"));
      expect(updatedConfig.auth.username).toBe("test@example.com");
      expect(updatedConfig.auth.password).toBe("secret");
      expect(updatedConfig.auth.organizationUrl).toBe(
        "https://org.example.com",
      );
      expect(updatedConfig.sendSessionTranscript).toBe("enabled");
      expect(updatedConfig.agents?.["claude-code"]?.profile?.baseProfile).toBe(
        "new-profile",
      );
    });

    test("throws error for non-existent profile", async () => {
      // Create profiles directory but no profiles
      const profilesDir = path.join(testInstallDir, ".nori", "profiles");
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

    test("switches to namespaced profile in nested directory", async () => {
      // Create org directory with nested profile (e.g., profiles/myorg/my-profile)
      const profilesDir = path.join(testInstallDir, ".nori", "profiles");
      const orgDir = path.join(profilesDir, "myorg");
      const profileDir = path.join(orgDir, "my-profile");
      await fs.mkdir(profileDir, { recursive: true });
      await fs.writeFile(
        path.join(profileDir, "CLAUDE.md"),
        "# myorg/my-profile",
      );

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
        profileName: "myorg/my-profile",
      });

      // Verify config was updated with namespaced profile name
      const updatedConfig = JSON.parse(await fs.readFile(configPath, "utf-8"));
      expect(updatedConfig.agents?.["claude-code"]?.profile?.baseProfile).toBe(
        "myorg/my-profile",
      );
    });
  });
});
