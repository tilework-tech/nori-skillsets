/**
 * Tests for configuration management with skillset-based system
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
  getDefaultAgents,
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

describe("loadConfig always reads from home directory", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "loadconfig-home-test-"));
    vi.mocked(os.homedir).mockReturnValue(tempDir);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("should always load config from ~/.nori-config.json regardless of cwd", async () => {
    // Create config only in home directory
    await fs.writeFile(
      path.join(tempDir, ".nori-config.json"),
      JSON.stringify({
        activeSkillset: "home-skillset",
      }),
    );

    const loaded = await loadConfig();

    expect(loaded?.activeSkillset).toBe("home-skillset");
  });

  it("should return null when no config exists in home directory", async () => {
    const loaded = await loadConfig();
    expect(loaded).toBeNull();
  });
});

describe("config with skillset-based system", () => {
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
    it("should save and load activeSkillset with auth", async () => {
      await saveConfig({
        username: "test@example.com",
        password: "password123",
        organizationUrl: "https://example.com",
        activeSkillset: "senior-swe",
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
      expect(loaded?.activeSkillset).toBe("senior-swe");
    });

    it("should save and load auth without activeSkillset", async () => {
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
      expect(loaded?.activeSkillset).toBeUndefined();
    });

    it("should save and load activeSkillset without auth", async () => {
      await saveConfig({
        username: null,
        password: null,
        organizationUrl: null,
        activeSkillset: "amol",
        installDir: tempDir,
      });

      const loaded = await loadConfig();

      expect(loaded?.auth).toBeNull();
      expect(loaded?.activeSkillset).toBe("amol");
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
        activeSkillset: "senior-swe",
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
          activeSkillset: "senior-swe",
          installDir: customDir,
        }),
      );

      const loaded = await loadConfig();
      expect(loaded?.installDir).toBe(customDir);
    });
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

describe("defaultAgents config", () => {
  let tempDir: string;
  let mockConfigPath: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "config-default-agents-test-"),
    );
    mockConfigPath = path.join(tempDir, ".nori-config.json");
    vi.mocked(os.homedir).mockReturnValue(tempDir);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("should save and load defaultAgents array", async () => {
    await saveConfig({
      username: null,
      organizationUrl: null,
      installDir: tempDir,
      defaultAgents: ["claude-code"],
      activeSkillset: "senior-swe",
    });

    const loaded = await loadConfig();

    expect(loaded?.defaultAgents).toEqual(["claude-code"]);
  });

  it("should return undefined defaultAgents when field is absent", async () => {
    await fs.writeFile(
      mockConfigPath,
      JSON.stringify({
        activeSkillset: "senior-swe",
      }),
    );

    const loaded = await loadConfig();

    expect(loaded?.defaultAgents).toBeUndefined();
  });

  it("should persist defaultAgents array to disk", async () => {
    await saveConfig({
      username: null,
      organizationUrl: null,
      installDir: tempDir,
      defaultAgents: ["claude-code"],
      activeSkillset: "senior-swe",
    });

    const content = await fs.readFile(mockConfigPath, "utf-8");
    const config = JSON.parse(content);

    expect(config.defaultAgents).toEqual(["claude-code"]);
  });

  it("should not write defaultAgent (singular) to disk", async () => {
    await saveConfig({
      username: null,
      organizationUrl: null,
      installDir: tempDir,
      defaultAgents: ["claude-code"],
      activeSkillset: "senior-swe",
    });

    const content = await fs.readFile(mockConfigPath, "utf-8");
    const config = JSON.parse(content);

    expect(config.defaultAgent).toBeUndefined();
  });
});

describe("getDefaultAgents", () => {
  it("should return defaultAgents array from config", () => {
    const config: Config = {
      installDir: "/test",
      defaultAgents: ["claude-code"],
    };

    const result = getDefaultAgents({ config });

    expect(result).toEqual(["claude-code"]);
  });

  it("should return agentOverride as single-element array when provided", () => {
    const config: Config = {
      installDir: "/test",
      defaultAgents: ["claude-code"],
    };

    const result = getDefaultAgents({ config, agentOverride: "other-agent" });

    expect(result).toEqual(["other-agent"]);
  });

  it("should fall back to claude-code when defaultAgents is not set", () => {
    const config: Config = {
      installDir: "/test",
    };

    const result = getDefaultAgents({ config });

    expect(result).toEqual(["claude-code"]);
  });

  it("should fall back to claude-code when no config at all", () => {
    const result = getDefaultAgents({ config: null });

    expect(result).toEqual(["claude-code"]);
  });

  it("should ignore empty defaultAgents array and fall back", () => {
    const config: Config = {
      installDir: "/test",
      defaultAgents: [],
    };

    const result = getDefaultAgents({ config });

    expect(result).toEqual(["claude-code"]);
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
          activeSkillset: "senior-swe",
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
          activeSkillset: "senior-swe",
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
          activeSkillset: "senior-swe",
          unknownField: "should be removed",
          anotherUnknown: { nested: "value" },
        }),
      );

      const loaded = await loadConfig();

      expect(loaded).not.toBeNull();
      expect(loaded?.activeSkillset).toBe("senior-swe");
      // Unknown properties should be stripped
      expect((loaded as any).unknownField).toBeUndefined();
      expect((loaded as any).anotherUnknown).toBeUndefined();
    });
  });
});

describe("activeSkillset config", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "config-active-skillset-test-"),
    );
    vi.mocked(os.homedir).mockReturnValue(tempDir);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  describe("saveConfig and loadConfig with activeSkillset", () => {
    it("should save and load activeSkillset", async () => {
      await saveConfig({
        username: null,
        organizationUrl: null,
        activeSkillset: "senior-swe",
        installDir: tempDir,
      });

      const loaded = await loadConfig();

      expect(loaded?.activeSkillset).toBe("senior-swe");
    });

    it("should save activeSkillset with auth", async () => {
      await saveConfig({
        username: "test@example.com",
        refreshToken: "token-123",
        organizationUrl: "https://example.com",
        activeSkillset: "senior-swe",
        installDir: tempDir,
      });

      const loaded = await loadConfig();

      expect(loaded?.activeSkillset).toBe("senior-swe");
      expect(loaded?.auth?.username).toBe("test@example.com");
    });

    it("should return null activeSkillset when not set", async () => {
      await saveConfig({
        username: null,
        organizationUrl: null,
        installDir: tempDir,
      });

      const loaded = await loadConfig();

      expect(loaded?.activeSkillset).toBeUndefined();
    });
  });

  describe("getActiveSkillset", () => {
    it("should return activeSkillset from config", async () => {
      const { getActiveSkillset } = await import("./config.js");

      const config: Config = {
        installDir: "/test",
        activeSkillset: "senior-swe",
      };

      expect(getActiveSkillset({ config })).toBe("senior-swe");
    });

    it("should return null when activeSkillset is not set", async () => {
      const { getActiveSkillset } = await import("./config.js");

      const config: Config = {
        installDir: "/test",
      };

      expect(getActiveSkillset({ config })).toBeNull();
    });

    it("should return null when activeSkillset is null", async () => {
      const { getActiveSkillset } = await import("./config.js");

      const config: Config = {
        installDir: "/test",
        activeSkillset: null,
      };

      expect(getActiveSkillset({ config })).toBeNull();
    });
  });
});
