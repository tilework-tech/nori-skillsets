/**
 * Tests for config command
 *
 * These tests verify the configMain function behavior including:
 * - Interactive mode: calls flow, saves config on success
 * - Cancel: flow returns null, config is not saved
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

import { loadConfig, saveConfig } from "@/cli/config.js";

// Mock os.homedir so getConfigPath resolves to test directories
vi.mock("os", async (importOriginal) => {
  const actual = await importOriginal<typeof os>();
  return {
    ...actual,
    homedir: vi.fn().mockReturnValue(actual.homedir()),
  };
});

// Mock clack prompts (outro is called in configMain after save)
vi.mock("@clack/prompts", () => ({
  outro: vi.fn(),
}));

// Mock the config flow
vi.mock("@/cli/prompts/flows/config.js", () => ({
  configFlow: vi.fn(),
}));

// Mock AgentRegistry
vi.mock("@/cli/features/agentRegistry.js", () => ({
  AgentRegistry: {
    getInstance: vi.fn().mockReturnValue({
      list: vi.fn().mockReturnValue(["claude-code"]),
      get: vi.fn().mockReturnValue({
        name: "claude-code",
        displayName: "Claude Code",
      }),
    }),
  },
}));

describe("configMain", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "config-cmd-test-"));
    vi.mocked(os.homedir).mockReturnValue(tempDir);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("should save defaultAgents and installDir to config when flow succeeds", async () => {
    const { configFlow } = await import("@/cli/prompts/flows/config.js");
    vi.mocked(configFlow).mockResolvedValueOnce({
      defaultAgents: ["claude-code"],
      installDir: tempDir,
    });

    // Create a minimal existing config so loadConfig returns something
    await saveConfig({
      username: null,
      organizationUrl: null,
      installDir: tempDir,
      agents: { "claude-code": { profile: { baseProfile: "senior-swe" } } },
    });

    const { configMain } = await import("./config.js");
    await configMain();

    const loaded = await loadConfig();
    expect(loaded?.defaultAgents).toEqual(["claude-code"]);
    expect(loaded?.installDir).toBe(tempDir);
  });

  it("should not modify config when flow returns null (user cancelled)", async () => {
    const { configFlow } = await import("@/cli/prompts/flows/config.js");
    vi.mocked(configFlow).mockResolvedValueOnce(null);

    // Create an existing config
    await saveConfig({
      username: null,
      organizationUrl: null,
      installDir: tempDir,
      agents: { "claude-code": { profile: { baseProfile: "senior-swe" } } },
    });

    const configBefore = await loadConfig();

    const { configMain } = await import("./config.js");
    await configMain();

    const configAfter = await loadConfig();
    expect(configAfter?.installDir).toBe(configBefore?.installDir);
  });

  it("should preserve existing config fields when saving", async () => {
    const { configFlow } = await import("@/cli/prompts/flows/config.js");
    vi.mocked(configFlow).mockResolvedValueOnce({
      defaultAgents: ["claude-code"],
      installDir: "/new/path",
    });

    // Create config with auth and agents
    await saveConfig({
      username: "test@example.com",
      refreshToken: "token-123",
      organizationUrl: "https://example.com",
      installDir: tempDir,
      agents: { "claude-code": { profile: { baseProfile: "senior-swe" } } },
      sendSessionTranscript: "disabled",
    });

    const { configMain } = await import("./config.js");
    await configMain();

    const loaded = await loadConfig();
    expect(loaded?.auth?.username).toBe("test@example.com");
    expect(loaded?.agents?.["claude-code"]?.profile?.baseProfile).toBe(
      "senior-swe",
    );
    expect(loaded?.sendSessionTranscript).toBe("disabled");
    expect(loaded?.defaultAgents).toEqual(["claude-code"]);
    expect(loaded?.installDir).toBe("/new/path");
  });
});
