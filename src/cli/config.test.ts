/**
 * Tests for configuration management with profile-based system
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  loadConfig,
  saveConfig,
  getConfigPath,
  isPaidInstall,
  getInstalledAgents,
  type Config,
} from "./config.js";

describe("getConfigPath", () => {
  let originalCwd: () => string;

  beforeEach(() => {
    originalCwd = process.cwd;
  });

  afterEach(() => {
    process.cwd = originalCwd;
  });

  describe("default behavior", () => {
    it("should return installDir/.nori-config.json when valid installDir is provided", () => {
      const result = getConfigPath({ installDir: "/mock/project/dir" });
      expect(result).toBe("/mock/project/dir/.nori-config.json");
    });

    it("should handle relative path", () => {
      const result = getConfigPath({ installDir: "relative/path" });
      expect(result).toBe("relative/path/.nori-config.json");
    });
  });

  describe("custom installDir", () => {
    it("should return <installDir>/.nori-config.json when custom installDir provided", () => {
      const result = getConfigPath({ installDir: "/custom/path" });
      expect(result).toBe("/custom/path/.nori-config.json");
    });
  });
});

describe("config with profile-based system", () => {
  let tempDir: string;
  let mockConfigPath: string;
  let originalCwd: () => string;

  beforeEach(async () => {
    // Create temp directory for testing
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "config-test-"));
    mockConfigPath = path.join(tempDir, ".nori-config.json");

    // Mock process.cwd() to return temp directory
    originalCwd = process.cwd;
    process.cwd = () => tempDir;
  });

  afterEach(async () => {
    // Restore process.cwd
    process.cwd = originalCwd;

    // Clean up temp directory
    await fs.rm(tempDir, { recursive: true, force: true });

    // Clear all mocks
    vi.clearAllMocks();
  });

  describe("saveConfig and loadConfig", () => {
    it("should save and load agents with auth", async () => {
      await saveConfig({
        username: "test@example.com",
        password: "password123",
        organizationUrl: "https://example.com",
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
        installDir: tempDir,
      });

      const loaded = await loadConfig({ installDir: tempDir });

      expect(loaded?.auth).toEqual({
        username: "test@example.com",
        password: "password123",
        refreshToken: null,
        organizationUrl: "https://example.com",
      });
      expect(loaded?.agents).toEqual({
        "claude-code": { profile: { baseProfile: "senior-swe" } },
      });
    });

    it("should save and load auth without agents", async () => {
      await saveConfig({
        username: "test@example.com",
        password: "password123",
        organizationUrl: "https://example.com",
        installDir: tempDir,
      });

      const loaded = await loadConfig({ installDir: tempDir });

      expect(loaded?.auth).toEqual({
        username: "test@example.com",
        password: "password123",
        refreshToken: null,
        organizationUrl: "https://example.com",
      });
      expect(loaded?.agents).toBeUndefined();
    });

    it("should save and load agents without auth", async () => {
      await saveConfig({
        username: null,
        password: null,
        organizationUrl: null,
        agents: {
          "claude-code": { profile: { baseProfile: "amol" } },
        },
        installDir: tempDir,
      });

      const loaded = await loadConfig({ installDir: tempDir });

      expect(loaded?.auth).toBeNull();
      expect(loaded?.agents).toEqual({
        "claude-code": { profile: { baseProfile: "amol" } },
      });
    });

    it("should return null when config file does not exist", async () => {
      const loaded = await loadConfig({ installDir: tempDir });
      expect(loaded).toBeNull();
    });

    it("should handle malformed config gracefully", async () => {
      await fs.writeFile(mockConfigPath, "invalid json {");

      const loaded = await loadConfig({ installDir: tempDir });
      expect(loaded).toBeNull();
    });

    it("should load sendSessionTranscript when set to enabled", async () => {
      await fs.writeFile(
        mockConfigPath,
        JSON.stringify({ sendSessionTranscript: "enabled" }),
      );

      const loaded = await loadConfig({ installDir: tempDir });

      expect(loaded?.sendSessionTranscript).toBe("enabled");
    });

    it("should load sendSessionTranscript when set to disabled", async () => {
      await fs.writeFile(
        mockConfigPath,
        JSON.stringify({ sendSessionTranscript: "disabled" }),
      );

      const loaded = await loadConfig({ installDir: tempDir });

      expect(loaded?.sendSessionTranscript).toBe("disabled");
    });

    it("should default sendSessionTranscript to enabled when field is missing", async () => {
      await fs.writeFile(mockConfigPath, JSON.stringify({}));

      const loaded = await loadConfig({ installDir: tempDir });

      expect(loaded?.sendSessionTranscript).toBe("enabled");
    });

    it("should save and load sendSessionTranscript", async () => {
      await saveConfig({
        username: null,
        password: null,
        organizationUrl: null,
        sendSessionTranscript: "disabled",
        installDir: tempDir,
      });

      const loaded = await loadConfig({ installDir: tempDir });

      expect(loaded?.sendSessionTranscript).toBe("disabled");
    });

    it("should load autoupdate when set to enabled", async () => {
      await fs.writeFile(
        mockConfigPath,
        JSON.stringify({ autoupdate: "enabled" }),
      );

      const loaded = await loadConfig({ installDir: tempDir });

      expect(loaded?.autoupdate).toBe("enabled");
    });

    it("should load autoupdate when set to disabled", async () => {
      await fs.writeFile(
        mockConfigPath,
        JSON.stringify({ autoupdate: "disabled" }),
      );

      const loaded = await loadConfig({ installDir: tempDir });

      expect(loaded?.autoupdate).toBe("disabled");
    });

    it("should default autoupdate to disabled when field is missing", async () => {
      await fs.writeFile(mockConfigPath, JSON.stringify({}));

      const loaded = await loadConfig({ installDir: tempDir });

      expect(loaded?.autoupdate).toBe("disabled");
    });

    it("should save and load autoupdate", async () => {
      await saveConfig({
        username: null,
        password: null,
        organizationUrl: null,
        autoupdate: "disabled",
        installDir: tempDir,
      });

      const loaded = await loadConfig({ installDir: tempDir });

      expect(loaded?.autoupdate).toBe("disabled");
    });
  });

  describe("installDir configuration", () => {
    it("should save config to custom installDir as .nori-config.json", async () => {
      const customDir = path.join(tempDir, "custom-project");
      await fs.mkdir(customDir, { recursive: true });

      await saveConfig({
        username: "test@example.com",
        password: "password123",
        organizationUrl: "https://example.com",
        installDir: customDir,
      });

      // Config should be at customDir/.nori-config.json
      const configPath = path.join(customDir, ".nori-config.json");
      const exists = await fs
        .access(configPath)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);

      // Should NOT be at HOME/nori-config.json
      const homeConfig = path.join(tempDir, "nori-config.json");
      const homeExists = await fs
        .access(homeConfig)
        .then(() => true)
        .catch(() => false);
      expect(homeExists).toBe(false);
    });

    it("should load config from custom installDir", async () => {
      const customDir = path.join(tempDir, "custom-project");
      await fs.mkdir(customDir, { recursive: true });

      // Write config to custom location
      const configPath = path.join(customDir, ".nori-config.json");
      await fs.writeFile(
        configPath,
        JSON.stringify({
          username: "custom@example.com",
          password: "custompass",
          organizationUrl: "https://custom.com",
        }),
      );

      const loaded = await loadConfig({ installDir: customDir });

      expect(loaded?.auth).toEqual({
        username: "custom@example.com",
        password: "custompass",
        refreshToken: null,
        organizationUrl: "https://custom.com",
      });
    });

    it("should return null when config does not exist in custom installDir", async () => {
      const customDir = path.join(tempDir, "empty-project");
      await fs.mkdir(customDir, { recursive: true });

      const loaded = await loadConfig({ installDir: customDir });
      expect(loaded).toBeNull();
    });

    it("should save installDir in config for persistence", async () => {
      const customDir = path.join(tempDir, "custom-project");
      await fs.mkdir(customDir, { recursive: true });

      await saveConfig({
        username: null,
        password: null,
        organizationUrl: null,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
        installDir: customDir,
      });

      // Read the raw config to verify installDir is saved
      const configPath = path.join(customDir, ".nori-config.json");
      const content = await fs.readFile(configPath, "utf-8");
      const config = JSON.parse(content);

      expect(config.installDir).toBe(customDir);
    });

    it("should load installDir from config", async () => {
      const customDir = path.join(tempDir, "custom-project");
      await fs.mkdir(customDir, { recursive: true });

      // Write config with installDir
      const configPath = path.join(customDir, ".nori-config.json");
      await fs.writeFile(
        configPath,
        JSON.stringify({
          agents: {
            "claude-code": { profile: { baseProfile: "senior-swe" } },
          },
          installDir: customDir,
        }),
      );

      const loaded = await loadConfig({ installDir: customDir });
      expect(loaded?.installDir).toBe(customDir);
    });
  });
});

describe("isPaidInstall", () => {
  it("should return true when config has auth with all fields", () => {
    const config: Config = {
      auth: {
        username: "test@example.com",
        password: "password123",
        organizationUrl: "https://example.com",
      },
      installDir: "/test/dir",
    };

    expect(isPaidInstall({ config })).toBe(true);
  });

  it("should return false when config has no auth", () => {
    const config: Config = {
      installDir: "/test/dir",
    };

    expect(isPaidInstall({ config })).toBe(false);
  });

  it("should return false when config has auth set to null", () => {
    const config: Config = {
      auth: null,
      installDir: "/test/dir",
    };

    expect(isPaidInstall({ config })).toBe(false);
  });
});

describe("agent-specific profiles", () => {
  let tempDir: string;
  let mockConfigPath: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "config-agents-test-"));
    mockConfigPath = path.join(tempDir, ".nori-config.json");
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe("loadConfig with agents field", () => {
    it("should load config with agents structure", async () => {
      await fs.writeFile(
        mockConfigPath,
        JSON.stringify({
          agents: {
            "claude-code": {
              profile: { baseProfile: "senior-swe" },
            },
          },
        }),
      );

      const loaded = await loadConfig({ installDir: tempDir });

      expect(loaded?.agents).toEqual({
        "claude-code": {
          profile: { baseProfile: "senior-swe" },
        },
      });
    });

    it("should support multiple agents with different profiles", async () => {
      await fs.writeFile(
        mockConfigPath,
        JSON.stringify({
          agents: {
            "claude-code": {
              profile: { baseProfile: "senior-swe" },
            },
            cursor: {
              profile: { baseProfile: "documenter" },
            },
          },
        }),
      );

      const loaded = await loadConfig({ installDir: tempDir });

      expect(loaded?.agents?.["claude-code"]?.profile?.baseProfile).toBe(
        "senior-swe",
      );
      expect(loaded?.agents?.["cursor"]?.profile?.baseProfile).toBe(
        "documenter",
      );
    });

    it("should migrate legacy profile field to agents.claude-code during load", async () => {
      // Legacy config with only 'profile' field (no 'agents')
      // Note: This tests the backwards compatibility during loadConfig -
      // legacy profile is converted to agents structure
      await fs.writeFile(
        mockConfigPath,
        JSON.stringify({
          profile: { baseProfile: "amol" },
        }),
      );

      const loaded = await loadConfig({ installDir: tempDir });

      // Legacy profile should be converted to agents.claude-code.profile
      expect(loaded?.agents?.["claude-code"]?.profile?.baseProfile).toBe(
        "amol",
      );
    });

    it("should prefer agents field over legacy profile when both present during load", async () => {
      await fs.writeFile(
        mockConfigPath,
        JSON.stringify({
          profile: { baseProfile: "legacy-profile" },
          agents: {
            "claude-code": {
              profile: { baseProfile: "new-profile" },
            },
          },
        }),
      );

      const loaded = await loadConfig({ installDir: tempDir });

      // agents field should take precedence
      expect(loaded?.agents?.["claude-code"]?.profile?.baseProfile).toBe(
        "new-profile",
      );
    });

    it("should handle agent with null profile", async () => {
      await fs.writeFile(
        mockConfigPath,
        JSON.stringify({
          agents: {
            "claude-code": {
              profile: null,
            },
          },
        }),
      );

      const loaded = await loadConfig({ installDir: tempDir });

      expect(loaded?.agents?.["claude-code"]?.profile).toBeNull();
    });

    it("should handle agent with empty config", async () => {
      await fs.writeFile(
        mockConfigPath,
        JSON.stringify({
          agents: {
            "claude-code": {},
          },
        }),
      );

      const loaded = await loadConfig({ installDir: tempDir });

      expect(loaded?.agents?.["claude-code"]).toEqual({});
    });
  });

  describe("saveConfig with agents field", () => {
    it("should save agents structure", async () => {
      await saveConfig({
        username: null,
        password: null,
        organizationUrl: null,
        agents: {
          "claude-code": {
            profile: { baseProfile: "senior-swe" },
          },
        },
        installDir: tempDir,
      });

      const content = await fs.readFile(mockConfigPath, "utf-8");
      const config = JSON.parse(content);

      expect(config.agents).toEqual({
        "claude-code": {
          profile: { baseProfile: "senior-swe" },
        },
      });
    });

    it("should not write legacy profile field (only agents)", async () => {
      await saveConfig({
        username: null,
        password: null,
        organizationUrl: null,
        agents: {
          "claude-code": {
            profile: { baseProfile: "senior-swe" },
          },
        },
        installDir: tempDir,
      });

      const content = await fs.readFile(mockConfigPath, "utf-8");
      const config = JSON.parse(content);

      // Should only write agents, not legacy profile
      expect(config.agents["claude-code"].profile.baseProfile).toBe(
        "senior-swe",
      );
      expect(config.profile).toBeUndefined();
    });

    it("should save multiple agents without legacy profile", async () => {
      await saveConfig({
        username: null,
        password: null,
        organizationUrl: null,
        agents: {
          "claude-code": {
            profile: { baseProfile: "senior-swe" },
          },
          cursor: {
            profile: { baseProfile: "documenter" },
          },
        },
        installDir: tempDir,
      });

      const content = await fs.readFile(mockConfigPath, "utf-8");
      const config = JSON.parse(content);

      expect(config.agents["claude-code"].profile.baseProfile).toBe(
        "senior-swe",
      );
      expect(config.agents.cursor.profile.baseProfile).toBe("documenter");
      expect(config.profile).toBeUndefined();
    });
  });

  describe("getAgentProfile", () => {
    it("should return profile for specified agent from agents field", async () => {
      const { getAgentProfile } = await import("./config.js");

      const config: Config = {
        installDir: "/test",
        agents: {
          "claude-code": {
            profile: { baseProfile: "senior-swe" },
          },
          cursor: {
            profile: { baseProfile: "documenter" },
          },
        },
      };

      const claudeProfile = getAgentProfile({
        config,
        agentName: "claude-code",
      });
      const cursorProfile = getAgentProfile({ config, agentName: "cursor" });

      expect(claudeProfile?.baseProfile).toBe("senior-swe");
      expect(cursorProfile?.baseProfile).toBe("documenter");
    });

    it("should return null when agents field is missing", async () => {
      const { getAgentProfile } = await import("./config.js");

      const config: Config = {
        installDir: "/test",
        // No agents field
      };

      const profile = getAgentProfile({ config, agentName: "claude-code" });

      expect(profile).toBeNull();
    });

    it("should return null when agent has no profile configured", async () => {
      const { getAgentProfile } = await import("./config.js");

      const config: Config = {
        installDir: "/test",
        agents: {
          "claude-code": {},
        },
      };

      const profile = getAgentProfile({ config, agentName: "claude-code" });

      expect(profile).toBeNull();
    });

    it("should return null when agent not in agents field", async () => {
      const { getAgentProfile } = await import("./config.js");

      const config: Config = {
        installDir: "/test",
        agents: {
          "claude-code": {
            profile: { baseProfile: "senior-swe" },
          },
        },
      };

      const profile = getAgentProfile({ config, agentName: "cursor" });

      expect(profile).toBeNull();
    });
  });
});

describe("getInstalledAgents", () => {
  it("should return agent names from agents object keys", () => {
    const config: Config = {
      installDir: "/test",
      agents: {
        "claude-code": { profile: { baseProfile: "senior-swe" } },
        "cursor-agent": { profile: { baseProfile: "documenter" } },
      },
    };

    const installedAgents = getInstalledAgents({ config });

    expect(installedAgents).toEqual(
      expect.arrayContaining(["claude-code", "cursor-agent"]),
    );
    expect(installedAgents).toHaveLength(2);
  });

  it("should return claude-code by default when agents is null (backwards compatibility)", () => {
    const config: Config = {
      installDir: "/test",
      agents: null,
    };

    const installedAgents = getInstalledAgents({ config });

    expect(installedAgents).toEqual(["claude-code"]);
  });

  it("should return claude-code by default when agents is undefined (backwards compatibility)", () => {
    const config: Config = {
      installDir: "/test",
    };

    const installedAgents = getInstalledAgents({ config });

    expect(installedAgents).toEqual(["claude-code"]);
  });

  it("should return claude-code by default when agents is empty object (backwards compatibility)", () => {
    const config: Config = {
      installDir: "/test",
      agents: {},
    };

    const installedAgents = getInstalledAgents({ config });

    expect(installedAgents).toEqual(["claude-code"]);
  });

  it("should return single agent when only one is configured", () => {
    const config: Config = {
      installDir: "/test",
      agents: {
        "claude-code": { profile: { baseProfile: "senior-swe" } },
      },
    };

    const installedAgents = getInstalledAgents({ config });

    expect(installedAgents).toEqual(["claude-code"]);
  });

  it("should include agent even if profile is null", () => {
    const config: Config = {
      installDir: "/test",
      agents: {
        "claude-code": { profile: null },
      },
    };

    const installedAgents = getInstalledAgents({ config });

    expect(installedAgents).toEqual(["claude-code"]);
  });

  it("should include agent even if config is empty object", () => {
    const config: Config = {
      installDir: "/test",
      agents: {
        "claude-code": {},
      },
    };

    const installedAgents = getInstalledAgents({ config });

    expect(installedAgents).toEqual(["claude-code"]);
  });
});

describe("saveConfig should not write installedAgents", () => {
  let tempDir: string;
  let mockConfigPath: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "config-no-installed-agents-test-"),
    );
    mockConfigPath = path.join(tempDir, ".nori-config.json");
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("should not write installedAgents field to disk", async () => {
    await saveConfig({
      username: null,
      password: null,
      organizationUrl: null,
      agents: {
        "claude-code": { profile: { baseProfile: "senior-swe" } },
      },
      installDir: tempDir,
    });

    const content = await fs.readFile(mockConfigPath, "utf-8");
    const config = JSON.parse(content);

    // installedAgents should NOT be in the saved config
    expect(config.installedAgents).toBeUndefined();
    // agents should be present
    expect(config.agents).toBeDefined();
    expect(config.agents["claude-code"]).toBeDefined();
  });
});

describe("registryAuths", () => {
  let tempDir: string;
  let mockConfigPath: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "config-registry-test-"));
    mockConfigPath = path.join(tempDir, ".nori-config.json");
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe("loadConfig with registryAuths", () => {
    it("should load registryAuths when present and valid", async () => {
      await fs.writeFile(
        mockConfigPath,
        JSON.stringify({
          agents: {
            "claude-code": { profile: { baseProfile: "senior-swe" } },
          },
          registryAuths: [
            {
              username: "test@example.com",
              password: "password123",
              registryUrl: "https://registrar.tilework.tech",
            },
          ],
        }),
      );

      const loaded = await loadConfig({ installDir: tempDir });

      expect(loaded?.registryAuths).toEqual([
        {
          username: "test@example.com",
          password: "password123",
          registryUrl: "https://registrar.tilework.tech",
        },
      ]);
    });

    it("should load multiple registryAuths", async () => {
      await fs.writeFile(
        mockConfigPath,
        JSON.stringify({
          agents: {
            "claude-code": { profile: { baseProfile: "senior-swe" } },
          },
          registryAuths: [
            {
              username: "user1@example.com",
              password: "pass1",
              registryUrl: "https://registry1.example.com",
            },
            {
              username: "user2@example.com",
              password: "pass2",
              registryUrl: "https://registry2.example.com",
            },
          ],
        }),
      );

      const loaded = await loadConfig({ installDir: tempDir });

      expect(loaded?.registryAuths).toHaveLength(2);
      expect(loaded?.registryAuths?.[0].registryUrl).toBe(
        "https://registry1.example.com",
      );
      expect(loaded?.registryAuths?.[1].registryUrl).toBe(
        "https://registry2.example.com",
      );
    });

    it("should filter out invalid registryAuths entries", async () => {
      await fs.writeFile(
        mockConfigPath,
        JSON.stringify({
          agents: {
            "claude-code": { profile: { baseProfile: "senior-swe" } },
          },
          registryAuths: [
            {
              username: "valid@example.com",
              password: "validpass",
              registryUrl: "https://valid.example.com",
            },
            {
              // Missing password
              username: "invalid@example.com",
              registryUrl: "https://invalid.example.com",
            },
            {
              // Missing username
              password: "pass",
              registryUrl: "https://invalid2.example.com",
            },
            {
              // Missing registryUrl
              username: "user@example.com",
              password: "pass",
            },
            "not an object",
            null,
          ],
        }),
      );

      const loaded = await loadConfig({ installDir: tempDir });

      expect(loaded?.registryAuths).toHaveLength(1);
      expect(loaded?.registryAuths?.[0].username).toBe("valid@example.com");
    });

    it("should return null registryAuths when array is empty after filtering", async () => {
      await fs.writeFile(
        mockConfigPath,
        JSON.stringify({
          agents: {
            "claude-code": { profile: { baseProfile: "senior-swe" } },
          },
          registryAuths: [
            { username: "incomplete" }, // Invalid - missing fields
          ],
        }),
      );

      const loaded = await loadConfig({ installDir: tempDir });

      expect(loaded?.registryAuths).toBeUndefined();
    });

    it("should handle non-array registryAuths gracefully", async () => {
      await fs.writeFile(
        mockConfigPath,
        JSON.stringify({
          agents: {
            "claude-code": { profile: { baseProfile: "senior-swe" } },
          },
          registryAuths: "not an array",
        }),
      );

      const loaded = await loadConfig({ installDir: tempDir });

      expect(loaded?.registryAuths).toBeUndefined();
    });
  });

  describe("saveConfig with registryAuths", () => {
    it("should save registryAuths to config file", async () => {
      await saveConfig({
        username: null,
        password: null,
        organizationUrl: null,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
        registryAuths: [
          {
            username: "test@example.com",
            password: "testpass",
            registryUrl: "https://registrar.tilework.tech",
          },
        ],
        installDir: tempDir,
      });

      const content = await fs.readFile(mockConfigPath, "utf-8");
      const config = JSON.parse(content);

      expect(config.registryAuths).toEqual([
        {
          username: "test@example.com",
          password: "testpass",
          registryUrl: "https://registrar.tilework.tech",
        },
      ]);
    });

    it("should not save registryAuths when null", async () => {
      await saveConfig({
        username: null,
        password: null,
        organizationUrl: null,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
        registryAuths: null,
        installDir: tempDir,
      });

      const content = await fs.readFile(mockConfigPath, "utf-8");
      const config = JSON.parse(content);

      expect(config.registryAuths).toBeUndefined();
    });

    it("should not save registryAuths when empty array", async () => {
      await saveConfig({
        username: null,
        password: null,
        organizationUrl: null,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
        registryAuths: [],
        installDir: tempDir,
      });

      const content = await fs.readFile(mockConfigPath, "utf-8");
      const config = JSON.parse(content);

      expect(config.registryAuths).toBeUndefined();
    });
  });

  describe("getRegistryAuth", () => {
    it("should find auth for matching registryUrl", async () => {
      const { getRegistryAuth } = await import("./config.js");

      const config: Config = {
        installDir: "/test",
        registryAuths: [
          {
            username: "test@example.com",
            password: "testpass",
            registryUrl: "https://registrar.tilework.tech",
          },
        ],
      };

      const auth = getRegistryAuth({
        config,
        registryUrl: "https://registrar.tilework.tech",
      });

      expect(auth).toEqual({
        username: "test@example.com",
        password: "testpass",
        registryUrl: "https://registrar.tilework.tech",
      });
    });

    it("should return null when no matching registryUrl", async () => {
      const { getRegistryAuth } = await import("./config.js");

      const config: Config = {
        installDir: "/test",
        registryAuths: [
          {
            username: "test@example.com",
            password: "testpass",
            registryUrl: "https://other-registry.example.com",
          },
        ],
      };

      const auth = getRegistryAuth({
        config,
        registryUrl: "https://registrar.tilework.tech",
      });

      expect(auth).toBeNull();
    });

    it("should return null when registryAuths is null", async () => {
      const { getRegistryAuth } = await import("./config.js");

      const config: Config = {
        installDir: "/test",
        registryAuths: null,
      };

      const auth = getRegistryAuth({
        config,
        registryUrl: "https://registrar.tilework.tech",
      });

      expect(auth).toBeNull();
    });

    it("should return null when registryAuths is undefined", async () => {
      const { getRegistryAuth } = await import("./config.js");

      const config: Config = {
        installDir: "/test",
      };

      const auth = getRegistryAuth({
        config,
        registryUrl: "https://registrar.tilework.tech",
      });

      expect(auth).toBeNull();
    });

    it("should match registryUrl with trailing slash normalization", async () => {
      const { getRegistryAuth } = await import("./config.js");

      const config: Config = {
        installDir: "/test",
        registryAuths: [
          {
            username: "test@example.com",
            password: "testpass",
            registryUrl: "https://registrar.tilework.tech/",
          },
        ],
      };

      // Search without trailing slash should find auth with trailing slash
      const auth = getRegistryAuth({
        config,
        registryUrl: "https://registrar.tilework.tech",
      });

      expect(auth).not.toBeNull();
      expect(auth?.username).toBe("test@example.com");
    });
  });
});

describe("token-based auth", () => {
  let tempDir: string;
  let mockConfigPath: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "config-token-test-"));
    mockConfigPath = path.join(tempDir, ".nori-config.json");
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe("saveConfig with refreshToken", () => {
    it("should save refreshToken in nested auth structure", async () => {
      await saveConfig({
        username: "test@example.com",
        password: null,
        organizationUrl: "https://example.com",
        refreshToken: "firebase-refresh-token-123",
        installDir: tempDir,
      });

      const content = await fs.readFile(mockConfigPath, "utf-8");
      const config = JSON.parse(content);

      // Auth should be nested structure
      expect(config.auth.refreshToken).toBe("firebase-refresh-token-123");
      expect(config.auth.username).toBe("test@example.com");
      expect(config.auth.password).toBeNull();
    });

    it("should not save password when refreshToken is provided", async () => {
      await saveConfig({
        username: "test@example.com",
        password: "should-be-ignored",
        organizationUrl: "https://example.com",
        refreshToken: "firebase-refresh-token-123",
        installDir: tempDir,
      });

      const content = await fs.readFile(mockConfigPath, "utf-8");
      const config = JSON.parse(content);

      // Nested auth should have refreshToken but password should be null
      expect(config.auth.refreshToken).toBe("firebase-refresh-token-123");
      expect(config.auth.password).toBeNull();
    });
  });

  describe("loadConfig with refreshToken", () => {
    it("should load refreshToken from config", async () => {
      await fs.writeFile(
        mockConfigPath,
        JSON.stringify({
          username: "test@example.com",
          refreshToken: "stored-refresh-token",
          organizationUrl: "https://example.com",
        }),
      );

      const loaded = await loadConfig({ installDir: tempDir });

      expect(loaded?.auth?.refreshToken).toBe("stored-refresh-token");
      expect(loaded?.auth?.username).toBe("test@example.com");
    });

    it("should detect legacy config with password but no refreshToken", async () => {
      const { isLegacyPasswordConfig } = await import("./config.js");

      await fs.writeFile(
        mockConfigPath,
        JSON.stringify({
          username: "test@example.com",
          password: "old-password",
          organizationUrl: "https://example.com",
        }),
      );

      const loaded = await loadConfig({ installDir: tempDir });
      const isLegacy = isLegacyPasswordConfig({ config: loaded! });

      expect(isLegacy).toBe(true);
    });

    it("should not detect token-based config as legacy", async () => {
      const { isLegacyPasswordConfig } = await import("./config.js");

      await fs.writeFile(
        mockConfigPath,
        JSON.stringify({
          username: "test@example.com",
          refreshToken: "new-token",
          organizationUrl: "https://example.com",
        }),
      );

      const loaded = await loadConfig({ installDir: tempDir });
      const isLegacy = isLegacyPasswordConfig({ config: loaded! });

      expect(isLegacy).toBe(false);
    });
  });

  describe("isPaidInstall with token-based auth", () => {
    it("should return true when config has auth with refreshToken", () => {
      const config: Config = {
        auth: {
          username: "test@example.com",
          refreshToken: "firebase-refresh-token",
          organizationUrl: "https://example.com",
        },
        installDir: "/test/dir",
      };

      expect(isPaidInstall({ config })).toBe(true);
    });

    it("should return true for legacy password-based auth", () => {
      const config: Config = {
        auth: {
          username: "test@example.com",
          password: "password123",
          organizationUrl: "https://example.com",
        },
        installDir: "/test/dir",
      };

      expect(isPaidInstall({ config })).toBe(true);
    });
  });
});

describe("schema validation", () => {
  let tempDir: string;
  let mockConfigPath: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "config-schema-test-"));
    mockConfigPath = path.join(tempDir, ".nori-config.json");
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe("enum validation", () => {
    it("should reject config with invalid sendSessionTranscript value", async () => {
      await fs.writeFile(
        mockConfigPath,
        JSON.stringify({
          sendSessionTranscript: "invalid-value",
          agents: {
            "claude-code": { profile: { baseProfile: "senior-swe" } },
          },
        }),
      );

      const loaded = await loadConfig({ installDir: tempDir });

      // Invalid enum value should cause config to be rejected
      expect(loaded).toBeNull();
    });

    it("should reject config with invalid autoupdate value", async () => {
      await fs.writeFile(
        mockConfigPath,
        JSON.stringify({
          autoupdate: "maybe",
          agents: {
            "claude-code": { profile: { baseProfile: "senior-swe" } },
          },
        }),
      );

      const loaded = await loadConfig({ installDir: tempDir });

      // Invalid enum value should cause config to be rejected
      expect(loaded).toBeNull();
    });
  });

  describe("URL format validation", () => {
    it("should reject config with malformed organizationUrl", async () => {
      const { validateConfig } = await import("./config.js");

      await fs.writeFile(
        mockConfigPath,
        JSON.stringify({
          username: "test@example.com",
          password: "password123",
          organizationUrl: "not-a-valid-url",
        }),
      );

      const result = await validateConfig({ installDir: tempDir });

      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors?.some((e) => e.includes("organizationUrl"))).toBe(
        true,
      );
    });
  });

  describe("unknown properties", () => {
    it("should strip unknown properties from loaded config", async () => {
      await fs.writeFile(
        mockConfigPath,
        JSON.stringify({
          agents: {
            "claude-code": { profile: { baseProfile: "senior-swe" } },
          },
          unknownField: "should be removed",
          anotherUnknown: { nested: "value" },
        }),
      );

      const loaded = await loadConfig({ installDir: tempDir });

      expect(loaded).not.toBeNull();
      expect(loaded?.agents?.["claude-code"]?.profile?.baseProfile).toBe(
        "senior-swe",
      );
      // Unknown properties should be stripped
      expect((loaded as any).unknownField).toBeUndefined();
      expect((loaded as any).anotherUnknown).toBeUndefined();
    });
  });

  describe("registryAuths filtering warning", () => {
    it("should warn when invalid registryAuths entries are filtered", async () => {
      // Logger's warn uses console.log (not console.warn)
      const logSpy = vi
        .spyOn(console, "log")
        .mockImplementation(() => undefined);

      await fs.writeFile(
        mockConfigPath,
        JSON.stringify({
          agents: {
            "claude-code": { profile: { baseProfile: "senior-swe" } },
          },
          registryAuths: [
            {
              username: "valid@example.com",
              password: "validpass",
              registryUrl: "https://valid.example.com",
            },
            {
              // Missing password - invalid
              username: "invalid@example.com",
              registryUrl: "https://invalid.example.com",
            },
          ],
        }),
      );

      const loaded = await loadConfig({ installDir: tempDir });

      expect(loaded?.registryAuths).toHaveLength(1);
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining("registryAuths"),
      );

      logSpy.mockRestore();
    });
  });
});
