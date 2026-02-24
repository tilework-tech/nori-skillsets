/**
 * Tests for AgentRegistry
 * Tests real behavior: selecting agents by name, listing available agents,
 * and shared handler functions operating on AgentConfig objects
 */

import * as fs from "fs/promises";
import * as os from "os";
import { tmpdir } from "os";
import * as path from "path";

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";

import { AgentRegistry, type Loader } from "@/cli/features/agentRegistry.js";
import {
  getAgentDir,
  getManagedFiles,
  getManagedDirs,
  detectExistingConfig,
  captureExistingConfig,
  switchSkillset,
  detectLocalChanges,
  removeSkillset,
  installSkillset,
} from "@/cli/features/shared/agentHandlers.js";

// Mock os.homedir so getNoriSkillsetsDir() resolves to test directories
vi.mock("os", async (importOriginal) => {
  const actual = await importOriginal<typeof os>();
  return {
    ...actual,
    homedir: vi.fn().mockReturnValue(actual.homedir()),
  };
});

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
      expect(agents).toHaveLength(2);
    });
  });

  describe("getDefaultAgentName", () => {
    test("returns the name of the first registered agent", () => {
      const registry = AgentRegistry.getInstance();
      const defaultName = registry.getDefaultAgentName();

      // Should return a valid agent name from the registry
      expect(registry.list()).toContain(defaultName);
      // Should be the same as the first agent in the list
      expect(defaultName).toBe(registry.list()[0]);
    });
  });

  describe("getAll", () => {
    test("returns the same agents accessible via get()", () => {
      const registry = AgentRegistry.getInstance();
      const allAgents = registry.getAll();
      const agentNames = registry.list();

      expect(allAgents).toHaveLength(agentNames.length);
      for (const agent of allAgents) {
        const lookedUp = registry.get({ name: agent.name });
        expect(lookedUp).toBe(agent);
      }
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

  describe("agent description", () => {
    test("every registered agent has a non-empty description", () => {
      const registry = AgentRegistry.getInstance();
      for (const name of registry.list()) {
        const agent = registry.get({ name });
        expect(agent.description).toBeDefined();
        expect(typeof agent.description).toBe("string");
        expect(agent.description.length).toBeGreaterThan(0);
      }
    });
  });

  describe("getAgentDir", () => {
    test("claude-code agent returns .claude directory under installDir", () => {
      const registry = AgentRegistry.getInstance();
      const agent = registry.get({ name: "claude-code" });
      const result = getAgentDir({
        agentConfig: agent,
        installDir: "/home/user/project",
      });

      expect(result).toBe("/home/user/project/.claude");
    });
  });

  describe("agent managed paths", () => {
    test("claude-code agent exposes getManagedFiles", () => {
      const registry = AgentRegistry.getInstance();
      const agent = registry.get({ name: "claude-code" });
      const managedFiles = getManagedFiles({ agentConfig: agent });

      expect(managedFiles).toContain("CLAUDE.md");
      expect(managedFiles).toContain("settings.json");
      expect(managedFiles).toContain("nori-statusline.sh");
    });

    test("claude-code agent exposes getManagedDirs", () => {
      const registry = AgentRegistry.getInstance();
      const agent = registry.get({ name: "claude-code" });
      const managedDirs = getManagedDirs({ agentConfig: agent });

      expect(managedDirs).toContain("skills");
      expect(managedDirs).toContain("commands");
      expect(managedDirs).toContain("agents");
    });
  });

  describe("agent extraLoaders", () => {
    test("claude-code agent has extra loaders", () => {
      const registry = AgentRegistry.getInstance();
      const agent = registry.get({ name: "claude-code" });

      expect(agent.extraLoaders).toBeDefined();
      expect(agent.extraLoaders!.length).toBeGreaterThan(0);
    });

    test("loaders satisfy the Loader type with required properties", () => {
      const registry = AgentRegistry.getInstance();
      const agent = registry.get({ name: "claude-code" });
      const loaders: ReadonlyArray<Loader> = agent.extraLoaders!;

      for (const loader of loaders) {
        expect(typeof loader.name).toBe("string");
        expect(typeof loader.description).toBe("string");
        expect(typeof loader.run).toBe("function");
      }
    });
  });

  describe("transcriptDirectory", () => {
    test("claude-code agent returns ~/.claude/projects", () => {
      const registry = AgentRegistry.getInstance();
      const agent = registry.get({ name: "claude-code" });

      const result = agent.transcriptDirectory;

      expect(result).toBe(path.join(os.homedir(), ".claude", "projects"));
    });

    test("cursor-agent does not expose a transcript directory", () => {
      const registry = AgentRegistry.getInstance();
      const agent = registry.get({ name: "cursor-agent" });

      const result = agent.transcriptDirectory;

      expect(result).toBeUndefined();
    });
  });

  describe("claude-code agent detectExistingConfig", () => {
    let testInstallDir: string;

    beforeEach(async () => {
      testInstallDir = await fs.mkdtemp(
        path.join(tmpdir(), "agent-detect-test-"),
      );
    });

    afterEach(async () => {
      if (testInstallDir) {
        await fs.rm(testInstallDir, { recursive: true, force: true });
      }
    });

    test("detects unmanaged config when it exists", async () => {
      const registry = AgentRegistry.getInstance();
      const agent = registry.get({ name: "claude-code" });

      // Create .claude dir with unmanaged CLAUDE.md
      const claudeDir = path.join(testInstallDir, ".claude");
      await fs.mkdir(claudeDir, { recursive: true });
      await fs.writeFile(
        path.join(claudeDir, "CLAUDE.md"),
        "# My custom config",
      );

      const result = await detectExistingConfig({
        agentConfig: agent,
        installDir: testInstallDir,
      });

      expect(result).not.toBeNull();
    });

    test("returns null when no config exists", async () => {
      const registry = AgentRegistry.getInstance();
      const agent = registry.get({ name: "claude-code" });

      const result = await detectExistingConfig({
        agentConfig: agent,
        installDir: testInstallDir,
      });

      expect(result).toBeNull();
    });
  });

  describe("claude-code agent captureExistingConfig", () => {
    let testInstallDir: string;

    beforeEach(async () => {
      testInstallDir = await fs.mkdtemp(
        path.join(tmpdir(), "agent-capture-test-"),
      );
      vi.mocked(os.homedir).mockReturnValue(testInstallDir);
    });

    afterEach(async () => {
      vi.restoreAllMocks();
      if (testInstallDir) {
        await fs.rm(testInstallDir, { recursive: true, force: true });
      }
    });

    test("captures existing config as a profile that can be switched to", async () => {
      const registry = AgentRegistry.getInstance();
      const agent = registry.get({ name: "claude-code" });

      // Create .claude dir with existing config
      const claudeDir = path.join(testInstallDir, ".claude");
      await fs.mkdir(claudeDir, { recursive: true });
      await fs.writeFile(
        path.join(claudeDir, "CLAUDE.md"),
        "# My custom config",
      );

      // Create profiles directory
      const skillsetsDir = path.join(testInstallDir, ".nori", "profiles");
      await fs.mkdir(skillsetsDir, { recursive: true });

      const config = {
        installDir: testInstallDir,
        activeSkillset: "captured-profile",
      };

      await captureExistingConfig({
        agentConfig: agent,
        installDir: testInstallDir,
        skillsetName: "captured-profile",
        config,
      });

      // Verify the captured profile is usable: switchSkillset should not throw
      // (it validates the profile exists and has a nori.json)
      await expect(
        switchSkillset({
          agentConfig: agent,
          installDir: testInstallDir,
          skillsetName: "captured-profile",
        }),
      ).resolves.not.toThrow();
    });

    test("removes original config file after capture", async () => {
      const registry = AgentRegistry.getInstance();
      const agent = registry.get({ name: "claude-code" });

      // Create .claude dir with existing config
      const claudeDir = path.join(testInstallDir, ".claude");
      await fs.mkdir(claudeDir, { recursive: true });
      const originalClaudeMd = path.join(claudeDir, "CLAUDE.md");
      await fs.writeFile(originalClaudeMd, "# My custom config");

      // Create profiles directory
      const skillsetsDir = path.join(testInstallDir, ".nori", "profiles");
      await fs.mkdir(skillsetsDir, { recursive: true });

      const config = {
        installDir: testInstallDir,
        activeSkillset: "captured-profile",
      };

      await captureExistingConfig({
        agentConfig: agent,
        installDir: testInstallDir,
        skillsetName: "captured-profile",
        config,
      });

      // Original CLAUDE.md should be gone (replaced by managed version)
      // The managed version will have the managed block markers
      const resultContent = await fs.readFile(originalClaudeMd, "utf-8");
      expect(resultContent).toContain("BEGIN NORI-AI MANAGED BLOCK");
    });
  });

  describe("findArtifacts", () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = await fs.mkdtemp(path.join(tmpdir(), "agent-artifacts-test-"));
    });

    afterEach(async () => {
      await fs.rm(tempDir, { recursive: true, force: true });
    });

    test("claude-code agent finds .claude directories and CLAUDE.md files", async () => {
      const registry = AgentRegistry.getInstance();
      const agent = registry.get({ name: "claude-code" });

      // Create a .claude directory
      const claudeDir = path.join(tempDir, ".claude");
      await fs.mkdir(claudeDir, { recursive: true });

      // Create a CLAUDE.md file
      await fs.writeFile(path.join(tempDir, "CLAUDE.md"), "# Config");

      const artifacts = await agent.findArtifacts!({ startDir: tempDir });

      expect(artifacts.length).toBeGreaterThan(0);
      const paths = artifacts.map((a) => a.path);
      expect(paths).toContain(claudeDir);
      expect(paths).toContain(path.join(tempDir, "CLAUDE.md"));
    });

    test("claude-code agent returns empty array when no artifacts exist", async () => {
      const registry = AgentRegistry.getInstance();
      const agent = registry.get({ name: "claude-code" });

      const artifacts = await agent.findArtifacts!({
        startDir: tempDir,
        stopDir: tempDir,
      });

      expect(artifacts).toEqual([]);
    });
  });

  describe("claude-code agent detectLocalChanges", () => {
    let testInstallDir: string;

    beforeEach(async () => {
      testInstallDir = await fs.mkdtemp(
        path.join(tmpdir(), "agent-detect-changes-test-"),
      );
      vi.mocked(os.homedir).mockReturnValue(testInstallDir);
    });

    afterEach(async () => {
      vi.restoreAllMocks();
      if (testInstallDir) {
        await fs.rm(testInstallDir, { recursive: true, force: true });
      }
    });

    test("returns diff when managed files have been modified", async () => {
      const registry = AgentRegistry.getInstance();
      const agent = registry.get({ name: "claude-code" });

      // Set up agent dir with a managed file
      const agentDir = getAgentDir({
        agentConfig: agent,
        installDir: testInstallDir,
      });
      await fs.mkdir(agentDir, { recursive: true });
      const claudeMdPath = path.join(agentDir, "CLAUDE.md");
      await fs.writeFile(claudeMdPath, "# Original content");

      // Compute hash of original content and write manifest
      const { computeFileHash, writeManifest, getManifestPath } =
        await import("@/cli/features/manifest.js");
      const originalHash = await computeFileHash({ filePath: claudeMdPath });
      const manifestPath = getManifestPath({ agentName: agent.name });
      await writeManifest({
        manifestPath,
        manifest: {
          version: 1,
          createdAt: new Date().toISOString(),
          skillsetName: "test-skillset",
          files: { "CLAUDE.md": originalHash },
        },
      });

      // Modify the file
      await fs.writeFile(claudeMdPath, "# Modified content");

      // detectLocalChanges should report the modification
      const diff = await detectLocalChanges({
        agentConfig: agent,
        installDir: testInstallDir,
      });
      expect(diff).not.toBeNull();
      expect(diff!.modified).toContain("CLAUDE.md");
    });

    test("returns null when no manifest exists", async () => {
      const registry = AgentRegistry.getInstance();
      const agent = registry.get({ name: "claude-code" });

      // No manifest, no agent dir — should return null
      const diff = await detectLocalChanges({
        agentConfig: agent,
        installDir: testInstallDir,
      });
      expect(diff).toBeNull();
    });

    test("returns null when files match the manifest", async () => {
      const registry = AgentRegistry.getInstance();
      const agent = registry.get({ name: "claude-code" });

      // Set up agent dir with a managed file
      const agentDir = getAgentDir({
        agentConfig: agent,
        installDir: testInstallDir,
      });
      await fs.mkdir(agentDir, { recursive: true });
      const claudeMdPath = path.join(agentDir, "CLAUDE.md");
      await fs.writeFile(claudeMdPath, "# Original content");

      // Compute hash and write a matching manifest
      const { computeFileHash, writeManifest, getManifestPath } =
        await import("@/cli/features/manifest.js");
      const hash = await computeFileHash({ filePath: claudeMdPath });
      const manifestPath = getManifestPath({ agentName: agent.name });
      await writeManifest({
        manifestPath,
        manifest: {
          version: 1,
          createdAt: new Date().toISOString(),
          skillsetName: "test-skillset",
          files: { "CLAUDE.md": hash },
        },
      });

      // No changes — should return null
      const diff = await detectLocalChanges({
        agentConfig: agent,
        installDir: testInstallDir,
      });
      expect(diff).toBeNull();
    });
  });

  describe("claude-code agent removeSkillset", () => {
    let testInstallDir: string;

    beforeEach(async () => {
      testInstallDir = await fs.mkdtemp(
        path.join(tmpdir(), "agent-remove-test-"),
      );
      vi.mocked(os.homedir).mockReturnValue(testInstallDir);
    });

    afterEach(async () => {
      vi.restoreAllMocks();
      if (testInstallDir) {
        await fs.rm(testInstallDir, { recursive: true, force: true });
      }
    });

    test("removes managed files and manifest", async () => {
      const registry = AgentRegistry.getInstance();
      const agent = registry.get({ name: "claude-code" });

      // Set up agent dir with managed files
      const agentDir = getAgentDir({
        agentConfig: agent,
        installDir: testInstallDir,
      });
      await fs.mkdir(agentDir, { recursive: true });
      await fs.writeFile(path.join(agentDir, "CLAUDE.md"), "# Config");
      await fs.writeFile(path.join(agentDir, ".nori-managed"), "test-skillset");

      // Write a manifest that tracks CLAUDE.md
      const { computeFileHash, writeManifest, getManifestPath } =
        await import("@/cli/features/manifest.js");
      const hash = await computeFileHash({
        filePath: path.join(agentDir, "CLAUDE.md"),
      });
      const manifestPath = getManifestPath({ agentName: agent.name });
      await writeManifest({
        manifestPath,
        manifest: {
          version: 1,
          createdAt: new Date().toISOString(),
          skillsetName: "test-skillset",
          files: { "CLAUDE.md": hash },
        },
      });

      // Remove the skillset
      await removeSkillset({ agentConfig: agent, installDir: testInstallDir });

      // Managed file should be gone
      await expect(
        fs.access(path.join(agentDir, "CLAUDE.md")),
      ).rejects.toThrow();

      // .nori-managed marker should be gone
      await expect(
        fs.access(path.join(agentDir, ".nori-managed")),
      ).rejects.toThrow();

      // Manifest should be gone
      await expect(fs.access(manifestPath)).rejects.toThrow();
    });

    test("completes without error when no manifest exists", async () => {
      const registry = AgentRegistry.getInstance();
      const agent = registry.get({ name: "claude-code" });

      // No manifest, no agent dir — should not throw
      await expect(
        removeSkillset({ agentConfig: agent, installDir: testInstallDir }),
      ).resolves.not.toThrow();
    });
  });

  describe("claude-code agent switchSkillset", () => {
    let testInstallDir: string;

    beforeEach(async () => {
      testInstallDir = await fs.mkdtemp(
        path.join(tmpdir(), "agent-switch-test-"),
      );
      // Mock os.homedir so getNoriSkillsetsDir() resolves to testInstallDir/.nori/profiles
      vi.mocked(os.homedir).mockReturnValue(testInstallDir);
    });

    afterEach(async () => {
      vi.restoreAllMocks();
      if (testInstallDir) {
        await fs.rm(testInstallDir, { recursive: true, force: true });
      }
    });

    test("validates profile exists without modifying config on disk", async () => {
      // Create profiles directory with test profile
      const skillsetsDir = path.join(testInstallDir, ".nori", "profiles");
      const skillsetDir = path.join(skillsetsDir, "test-profile");
      await fs.mkdir(skillsetDir, { recursive: true });
      await fs.writeFile(
        path.join(skillsetDir, "nori.json"),
        JSON.stringify({ name: "test-profile", version: "1.0.0" }),
      );

      // Create initial config with various fields
      const configPath = path.join(testInstallDir, ".nori-config.json");
      const originalConfig = {
        username: "test@example.com",
        password: "secret",
        organizationUrl: "https://org.example.com",
        activeSkillset: "old-profile",
        sendSessionTranscript: "enabled",
      };
      await fs.writeFile(configPath, JSON.stringify(originalConfig));

      const registry = AgentRegistry.getInstance();
      const agent = registry.get({ name: "claude-code" });

      await switchSkillset({
        agentConfig: agent,
        installDir: testInstallDir,
        skillsetName: "test-profile",
      });

      // Config on disk should be completely unchanged
      const configAfter = JSON.parse(await fs.readFile(configPath, "utf-8"));
      expect(configAfter).toEqual(originalConfig);
    });

    test("throws error for non-existent profile", async () => {
      // Create profiles directory but no profiles
      const skillsetsDir = path.join(testInstallDir, ".nori", "profiles");
      await fs.mkdir(skillsetsDir, { recursive: true });

      const registry = AgentRegistry.getInstance();
      const agent = registry.get({ name: "claude-code" });

      await expect(
        switchSkillset({
          agentConfig: agent,
          installDir: testInstallDir,
          skillsetName: "non-existent",
        }),
      ).rejects.toThrow(/Profile "non-existent" not found/);
    });

    test("validates namespaced profile in nested directory without modifying config", async () => {
      // Create org directory with nested profile (e.g., profiles/myorg/my-profile)
      const skillsetsDir = path.join(testInstallDir, ".nori", "profiles");
      const orgDir = path.join(skillsetsDir, "myorg");
      const skillsetDir = path.join(orgDir, "my-profile");
      await fs.mkdir(skillsetDir, { recursive: true });
      await fs.writeFile(
        path.join(skillsetDir, "nori.json"),
        JSON.stringify({ name: "myorg/my-profile", version: "1.0.0" }),
      );

      // Create initial config
      const configPath = path.join(testInstallDir, ".nori-config.json");
      const originalConfig = { activeSkillset: "old-profile" };
      await fs.writeFile(configPath, JSON.stringify(originalConfig));

      const registry = AgentRegistry.getInstance();
      const agent = registry.get({ name: "claude-code" });

      await switchSkillset({
        agentConfig: agent,
        installDir: testInstallDir,
        skillsetName: "myorg/my-profile",
      });

      // Config on disk should be completely unchanged
      const configAfter = JSON.parse(await fs.readFile(configPath, "utf-8"));
      expect(configAfter).toEqual(originalConfig);
    });
  });

  describe("claude-code agent installSkillset", () => {
    let testInstallDir: string;

    beforeEach(async () => {
      testInstallDir = await fs.mkdtemp(
        path.join(tmpdir(), "agent-install-test-"),
      );
      vi.mocked(os.homedir).mockReturnValue(testInstallDir);
    });

    afterEach(async () => {
      vi.restoreAllMocks();
      if (testInstallDir) {
        await fs.rm(testInstallDir, { recursive: true, force: true });
      }
    });

    test("creates marker file and manifest after installation", async () => {
      const registry = AgentRegistry.getInstance();
      const agent = registry.get({ name: "claude-code" });

      // Create a skillset with CLAUDE.md
      const skillsetsDir = path.join(testInstallDir, ".nori", "profiles");
      const skillsetDir = path.join(skillsetsDir, "test-skillset");
      await fs.mkdir(skillsetDir, { recursive: true });
      await fs.writeFile(
        path.join(skillsetDir, "CLAUDE.md"),
        "# Test skillset config",
      );
      await fs.writeFile(
        path.join(skillsetDir, "nori.json"),
        JSON.stringify({ name: "test-skillset", version: "1.0.0" }),
      );

      // Create agent dir
      const agentDir = getAgentDir({
        agentConfig: agent,
        installDir: testInstallDir,
      });
      await fs.mkdir(agentDir, { recursive: true });

      // Create config pointing to the skillset
      const configPath = path.join(testInstallDir, ".nori-config.json");
      await fs.writeFile(
        configPath,
        JSON.stringify({
          activeSkillset: "test-skillset",
          installDir: testInstallDir,
        }),
      );

      const config = {
        installDir: testInstallDir,
        activeSkillset: "test-skillset",
      };

      await installSkillset({ agentConfig: agent, config });

      // Marker file should exist
      const markerPath = path.join(agentDir, ".nori-managed");
      await expect(fs.access(markerPath)).resolves.not.toThrow();

      // Manifest should exist
      const { getManifestPath } = await import("@/cli/features/manifest.js");
      const manifestPath = getManifestPath({ agentName: agent.name });
      await expect(fs.access(manifestPath)).resolves.not.toThrow();
    });

    test("installed state is detectable by detectLocalChanges", async () => {
      const registry = AgentRegistry.getInstance();
      const agent = registry.get({ name: "claude-code" });

      // Create a skillset with CLAUDE.md
      const skillsetsDir = path.join(testInstallDir, ".nori", "profiles");
      const skillsetDir = path.join(skillsetsDir, "test-skillset");
      await fs.mkdir(skillsetDir, { recursive: true });
      await fs.writeFile(
        path.join(skillsetDir, "CLAUDE.md"),
        "# Test skillset config",
      );
      await fs.writeFile(
        path.join(skillsetDir, "nori.json"),
        JSON.stringify({ name: "test-skillset", version: "1.0.0" }),
      );

      // Create agent dir
      const agentDir = getAgentDir({
        agentConfig: agent,
        installDir: testInstallDir,
      });
      await fs.mkdir(agentDir, { recursive: true });

      // Create config
      const configPath = path.join(testInstallDir, ".nori-config.json");
      await fs.writeFile(
        configPath,
        JSON.stringify({
          activeSkillset: "test-skillset",
          installDir: testInstallDir,
        }),
      );

      const config = {
        installDir: testInstallDir,
        activeSkillset: "test-skillset",
      };

      await installSkillset({ agentConfig: agent, config });

      // detectLocalChanges should return null (no changes since fresh install)
      const diff = await detectLocalChanges({
        agentConfig: agent,
        installDir: testInstallDir,
      });
      expect(diff).toBeNull();
    });

    test("completes without error on valid config", async () => {
      const registry = AgentRegistry.getInstance();
      const agent = registry.get({ name: "claude-code" });

      // Create a minimal skillset
      const skillsetsDir = path.join(testInstallDir, ".nori", "profiles");
      const skillsetDir = path.join(skillsetsDir, "minimal-skillset");
      await fs.mkdir(skillsetDir, { recursive: true });
      await fs.writeFile(path.join(skillsetDir, "CLAUDE.md"), "# Minimal");
      await fs.writeFile(
        path.join(skillsetDir, "nori.json"),
        JSON.stringify({ name: "minimal-skillset", version: "1.0.0" }),
      );

      // Create agent dir
      const agentDir = getAgentDir({
        agentConfig: agent,
        installDir: testInstallDir,
      });
      await fs.mkdir(agentDir, { recursive: true });

      // Create config
      const configPath = path.join(testInstallDir, ".nori-config.json");
      await fs.writeFile(
        configPath,
        JSON.stringify({
          activeSkillset: "minimal-skillset",
          installDir: testInstallDir,
        }),
      );

      const config = {
        installDir: testInstallDir,
        activeSkillset: "minimal-skillset",
      };

      await expect(
        installSkillset({ agentConfig: agent, config }),
      ).resolves.not.toThrow();
    });
  });
});
