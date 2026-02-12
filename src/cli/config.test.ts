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
  validateConfig,
  getInstalledAgents,
  type Config,
} from "./config.js";

// Mock os.homedir so getConfigPath resolves to test directories
vi.mock("os", async (importOriginal) => {
  const actual = await importOriginal<typeof os>();
  return {
    ...actual,
    homedir: vi.fn().mockReturnValue(actual.homedir()),
  };
});

describe("getConfigPath", () => {
  it("should always return ~/.nori-config.json", () => {
    const result = getConfigPath();
    expect(result).toBe(path.join(os.homedir(), ".nori-config.json"));
  });
});

describe("config with profile-based system", () => {
  let tempDir: string;
  let mockConfigPath: string;

  beforeEach(async () => {
    // Create temp directory for testing
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "config-test-"));
    mockConfigPath = path.join(tempDir, ".nori-config.json");

    // Mock os.homedir to return temp directory so getConfigPath resolves there
    vi.mocked(os.homedir).mockReturnValue(tempDir);
  });

  afterEach(async () => {
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

      const loaded = await loadConfig();

      expect(loaded?.auth).toEqual({
        username: "test@example.com",
        password: "password123",
        refreshToken: null,
        organizationUrl: "https://example.com",
        organizations: null,
        isAdmin: null,
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

      const loaded = await loadConfig();

      expect(loaded?.auth).toEqual({
        username: "test@example.com",
        password: "password123",
        refreshToken: null,
        organizationUrl: "https://example.com",
        organizations: null,
        isAdmin: null,
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

      const loaded = await loadConfig();

      expect(loaded?.auth).toBeNull();
      expect(loaded?.agents).toEqual({
        "claude-code": { profile: { baseProfile: "amol" } },
      });
    });

    it("should return null when config file does not exist", async () => {
      const loaded = await loadConfig();
      expect(loaded).toBeNull();
    });

    it("should handle malformed config gracefully", async () => {
      await fs.writeFile(mockConfigPath, "invalid json {");

      const loaded = await loadConfig();
      expect(loaded).toBeNull();
    });

    it("should load sendSessionTranscript when set to enabled", async () => {
      await fs.writeFile(
        mockConfigPath,
        JSON.stringify({ sendSessionTranscript: "enabled" }),
      );

      const loaded = await loadConfig();

      expect(loaded?.sendSessionTranscript).toBe("enabled");
    });

    it("should load sendSessionTranscript when set to disabled", async () => {
      await fs.writeFile(
        mockConfigPath,
        JSON.stringify({ sendSessionTranscript: "disabled" }),
      );

      const loaded = await loadConfig();

      expect(loaded?.sendSessionTranscript).toBe("disabled");
    });

    it("should default sendSessionTranscript to enabled when field is missing", async () => {
      await fs.writeFile(mockConfigPath, JSON.stringify({}));

      const loaded = await loadConfig();

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

      const loaded = await loadConfig();

      expect(loaded?.sendSessionTranscript).toBe("disabled");
    });

    it("should load autoupdate when set to enabled", async () => {
      await fs.writeFile(
        mockConfigPath,
        JSON.stringify({ autoupdate: "enabled" }),
      );

      const loaded = await loadConfig();

      expect(loaded?.autoupdate).toBe("enabled");
    });

    it("should load autoupdate when set to disabled", async () => {
      await fs.writeFile(
        mockConfigPath,
        JSON.stringify({ autoupdate: "disabled" }),
      );

      const loaded = await loadConfig();

      expect(loaded?.autoupdate).toBe("disabled");
    });

    it("should default autoupdate to disabled when field is missing", async () => {
      await fs.writeFile(mockConfigPath, JSON.stringify({}));

      const loaded = await loadConfig();

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

      const loaded = await loadConfig();

      expect(loaded?.autoupdate).toBe("disabled");
    });
  });

  describe("installDir configuration", () => {
    it("should always save config to ~/.nori-config.json", async () => {
      await saveConfig({
        username: "test@example.com",
        password: "password123",
        organizationUrl: "https://example.com",
        installDir: tempDir,
      });

      // Config should be at ~/.nori-config.json (mocked homedir is tempDir)
      const exists = await fs
        .access(mockConfigPath)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);
    });

    it("should save installDir in config as a data field", async () => {
      const customDir = "/some/custom/path";

      await saveConfig({
        username: null,
        password: null,
        organizationUrl: null,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
        installDir: customDir,
      });

      // Read the raw config to verify installDir is saved as data
      const content = await fs.readFile(mockConfigPath, "utf-8");
      const config = JSON.parse(content);

      expect(config.installDir).toBe(customDir);
    });

    it("should load installDir from config", async () => {
      const customDir = "/some/custom/path";

      // Write config with installDir
      await fs.writeFile(
        mockConfigPath,
        JSON.stringify({
          agents: {
            "claude-code": { profile: { baseProfile: "senior-swe" } },
          },
          installDir: customDir,
        }),
      );

      const loaded = await loadConfig();
      expect(loaded?.installDir).toBe(customDir);
    });
  });
});

describe("agent-specific profiles", () => {
  let tempDir: string;
  let mockConfigPath: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "config-agents-test-"));
    mockConfigPath = path.join(tempDir, ".nori-config.json");
    vi.mocked(os.homedir).mockReturnValue(tempDir);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
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

      const loaded = await loadConfig();

      expect(loaded?.agents).toEqual({
        "claude-code": {
          profile: { baseProfile: "senior-swe" },
        },
      });
    });

    it("should load claude-code agent config", async () => {
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

      const loaded = await loadConfig();

      expect(loaded?.agents?.["claude-code"]?.profile?.baseProfile).toBe(
        "senior-swe",
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

      const loaded = await loadConfig();

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

      const loaded = await loadConfig();

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

      const loaded = await loadConfig();

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

      const loaded = await loadConfig();

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

    it("should save claude-code agent without legacy profile", async () => {
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

      expect(config.agents["claude-code"].profile.baseProfile).toBe(
        "senior-swe",
      );
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
        },
      };

      const claudeProfile = getAgentProfile({
        config,
        agentName: "claude-code",
      });

      expect(claudeProfile?.baseProfile).toBe("senior-swe");
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
  });
});

describe("getInstalledAgents", () => {
  it("should return agent names from agents object keys", () => {
    const config: Config = {
      installDir: "/test",
      agents: {
        "claude-code": { profile: { baseProfile: "senior-swe" } },
      },
    };

    const installedAgents = getInstalledAgents({ config });

    expect(installedAgents).toEqual(["claude-code"]);
    expect(installedAgents).toHaveLength(1);
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
    vi.mocked(os.homedir).mockReturnValue(tempDir);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
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

describe("getRegistryAuth", () => {
  it("should return auth when unified auth org URL matches the requested registry URL", async () => {
    const { getRegistryAuth } = await import("./config.js");

    const config: Config = {
      installDir: "/test",
      auth: {
        username: "test@example.com",
        refreshToken: "token-123",
        organizationUrl: "https://myorg.tilework.tech",
      },
    };

    const auth = getRegistryAuth({
      config,
      registryUrl: "https://myorg.nori-registry.ai",
    });

    expect(auth).not.toBeNull();
    expect(auth?.username).toBe("test@example.com");
    expect(auth?.refreshToken).toBe("token-123");
    expect(auth?.registryUrl).toBe("https://myorg.nori-registry.ai");
    // Should NOT have password field
    expect((auth as any)?.password).toBeUndefined();
  });

  it("should return auth for localhost/local dev URLs", async () => {
    const { getRegistryAuth } = await import("./config.js");

    const config: Config = {
      installDir: "/test",
      auth: {
        username: "dev@example.com",
        refreshToken: "dev-token",
        organizationUrl: "http://localhost:3000",
      },
    };

    const auth = getRegistryAuth({
      config,
      registryUrl: "http://localhost:4000/registry",
    });

    expect(auth).not.toBeNull();
    expect(auth?.username).toBe("dev@example.com");
    expect(auth?.refreshToken).toBe("dev-token");
    // Should NOT have password field
    expect((auth as any)?.password).toBeUndefined();
  });

  it("should return null when no match", async () => {
    const { getRegistryAuth } = await import("./config.js");

    const config: Config = {
      installDir: "/test",
      auth: {
        username: "test@example.com",
        refreshToken: "token-123",
        organizationUrl: "https://myorg.tilework.tech",
      },
    };

    const auth = getRegistryAuth({
      config,
      registryUrl: "https://otherorg.nori-registry.ai",
    });

    expect(auth).toBeNull();
  });

  it("should return null when config has no auth", async () => {
    const { getRegistryAuth } = await import("./config.js");

    const config: Config = {
      installDir: "/test",
    };

    const auth = getRegistryAuth({
      config,
      registryUrl: "https://noriskillsets.dev",
    });

    expect(auth).toBeNull();
  });
});

describe("token-based auth", () => {
  let tempDir: string;
  let mockConfigPath: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "config-token-test-"));
    mockConfigPath = path.join(tempDir, ".nori-config.json");
    vi.mocked(os.homedir).mockReturnValue(tempDir);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
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

      const loaded = await loadConfig();

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

      const loaded = await loadConfig();
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

      const loaded = await loadConfig();
      const isLegacy = isLegacyPasswordConfig({ config: loaded! });

      expect(isLegacy).toBe(false);
    });
  });
});

describe("transcriptDestination config", () => {
  let tempDir: string;
  let mockConfigPath: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "config-transcript-dest-test-"),
    );
    mockConfigPath = path.join(tempDir, ".nori-config.json");
    vi.mocked(os.homedir).mockReturnValue(tempDir);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("should save and load transcriptDestination", async () => {
    await saveConfig({
      username: "test@example.com",
      password: null,
      refreshToken: "token-123",
      organizationUrl: "https://noriskillsets.dev",
      transcriptDestination: "myorg",
      installDir: tempDir,
    });

    const loaded = await loadConfig();

    expect(loaded?.transcriptDestination).toBe("myorg");
  });

  it("should load transcriptDestination when set in config file", async () => {
    await fs.writeFile(
      mockConfigPath,
      JSON.stringify({
        transcriptDestination: "acme-corp",
        installDir: tempDir,
      }),
    );

    const loaded = await loadConfig();

    expect(loaded?.transcriptDestination).toBe("acme-corp");
  });

  it("should return null for transcriptDestination when not set", async () => {
    await fs.writeFile(
      mockConfigPath,
      JSON.stringify({
        sendSessionTranscript: "enabled",
        installDir: tempDir,
      }),
    );

    const loaded = await loadConfig();

    expect(loaded?.transcriptDestination).toBeUndefined();
  });

  it("should preserve transcriptDestination when saving other fields", async () => {
    // First save with transcriptDestination
    await saveConfig({
      username: "test@example.com",
      password: null,
      refreshToken: "token-123",
      organizationUrl: "https://noriskillsets.dev",
      transcriptDestination: "myorg",
      installDir: tempDir,
    });

    // Load and verify
    const loaded = await loadConfig();
    expect(loaded?.transcriptDestination).toBe("myorg");
  });
});

describe("schema validation", () => {
  let tempDir: string;
  let mockConfigPath: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "config-schema-test-"));
    mockConfigPath = path.join(tempDir, ".nori-config.json");
    vi.mocked(os.homedir).mockReturnValue(tempDir);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
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

      const loaded = await loadConfig();

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

      const loaded = await loadConfig();

      // Invalid enum value should cause config to be rejected
      expect(loaded).toBeNull();
    });
  });

  describe("URL format validation", () => {
    it("should reject config with malformed organizationUrl", async () => {
      await fs.writeFile(
        mockConfigPath,
        JSON.stringify({
          username: "test@example.com",
          password: "password123",
          organizationUrl: "not-a-valid-url",
        }),
      );

      const result = await validateConfig();

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

      const loaded = await loadConfig();

      expect(loaded).not.toBeNull();
      expect(loaded?.agents?.["claude-code"]?.profile?.baseProfile).toBe(
        "senior-swe",
      );
      // Unknown properties should be stripped
      expect((loaded as any).unknownField).toBeUndefined();
      expect((loaded as any).anotherUnknown).toBeUndefined();
    });
  });
});
