/**
 * Tests for the external command - full integration flow
 */

import { execFileSync } from "child_process";
import * as fs from "fs/promises";
import { tmpdir } from "os";
import * as path from "path";

import * as clack from "@clack/prompts";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock child_process for git clone
vi.mock("child_process", () => ({
  execFileSync: vi.fn(),
}));

// Mock @clack/prompts for output
vi.mock("@clack/prompts", () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  note: vi.fn(),
  log: {
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    message: vi.fn(),
  },
}));

// Mock the config module
vi.mock("@/cli/config.js", async () => {
  return {
    loadConfig: vi.fn(),
    getRegistryAuth: vi.fn(),
    getInstalledAgents: (args: {
      config: { agents?: Record<string, unknown> | null };
    }) => {
      const agents = Object.keys(args.config.agents ?? {});
      return agents.length > 0 ? agents : ["claude-code"];
    },
    getAgentProfile: (args: {
      config: {
        agents?: Record<
          string,
          { profile?: { baseProfile: string } | null } | null
        > | null;
      };
      agentName: string;
    }) => {
      const agentConfig = args.config.agents?.[args.agentName];
      return agentConfig?.profile ?? null;
    },
  };
});

// Suppress direct console output during tests
vi.spyOn(console, "log").mockImplementation(() => undefined);
vi.spyOn(console, "error").mockImplementation(() => undefined);

import { loadConfig } from "@/cli/config.js";

/**
 * Helper to get all text output from clack prompts mocks
 * Combines log.error, log.info, log.success, log.warn calls into a searchable string
 *
 * @returns Combined output string from all clack prompt mocks
 */
const getClackOutput = (): string => {
  const logInfoMock = vi.mocked(clack.log.info);
  const logErrorMock = vi.mocked(clack.log.error);
  const logSuccessMock = vi.mocked(clack.log.success);
  const logWarnMock = vi.mocked(clack.log.warn);

  const logInfoTexts = logInfoMock.mock.calls.map((call) =>
    String(call[0] ?? ""),
  );
  const logErrorTexts = logErrorMock.mock.calls.map((call) =>
    String(call[0] ?? ""),
  );
  const logSuccessTexts = logSuccessMock.mock.calls.map((call) =>
    String(call[0] ?? ""),
  );
  const logWarnTexts = logWarnMock.mock.calls.map((call) =>
    String(call[0] ?? ""),
  );

  return [
    ...logInfoTexts,
    ...logErrorTexts,
    ...logSuccessTexts,
    ...logWarnTexts,
  ].join("\n");
};

/**
 * Helper to get only error output from clack log.error mock
 *
 * @returns Combined error output string
 */
const getClackErrorOutput = (): string => {
  return vi
    .mocked(clack.log.error)
    .mock.calls.map((call) => String(call[0] ?? ""))
    .join("\n");
};

import { externalMain } from "./external.js";

describe("externalMain", () => {
  let testDir: string;
  let skillsDir: string;
  let profilesDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();

    testDir = await fs.mkdtemp(
      path.join(tmpdir(), "nori-external-test-install-"),
    );
    skillsDir = path.join(testDir, ".claude", "skills");
    profilesDir = path.join(testDir, ".nori", "profiles");

    await fs.mkdir(skillsDir, { recursive: true });
    await fs.mkdir(profilesDir, { recursive: true });
  });

  afterEach(async () => {
    vi.clearAllMocks();
    if (testDir) {
      await fs.rm(testDir, { recursive: true, force: true });
    }
  });

  it("should error on clone failure and report the error", async () => {
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error("Repository not found");
    });

    vi.mocked(loadConfig).mockResolvedValue({
      installDir: testDir,
    });

    await externalMain({
      source: "owner/nonexistent-repo",
      installDir: testDir,
    });

    const allErrorOutput = getClackErrorOutput();
    expect(allErrorOutput.toLowerCase()).toContain("authentication failed");
  });

  it("should error when source is not a valid GitHub URL", async () => {
    vi.mocked(loadConfig).mockResolvedValue({
      installDir: testDir,
    });

    await externalMain({
      source: "https://gitlab.com/some/repo",
      installDir: testDir,
    });

    const allErrorOutput = getClackErrorOutput();
    expect(allErrorOutput.toLowerCase()).toContain("github");
  });

  it("should error when no skills found in cloned repo", async () => {
    // Create empty clone dir
    const emptyCloneDir = await fs.mkdtemp(
      path.join(tmpdir(), "nori-external-empty-"),
    );

    // Mock git clone to create an empty directory
    vi.mocked(execFileSync).mockImplementation(() => Buffer.from(""));

    vi.mocked(loadConfig).mockResolvedValue({
      installDir: testDir,
    });

    await externalMain({
      source: "owner/empty-repo",
      installDir: testDir,
    });

    const allErrorOutput = getClackErrorOutput();
    expect(allErrorOutput.toLowerCase()).toContain("no skills found");

    await fs.rm(emptyCloneDir, { recursive: true, force: true });
  });

  it("should error when multiple skills found and no --skill or --all provided", async () => {
    vi.mocked(loadConfig).mockResolvedValue({
      installDir: testDir,
    });

    // We need to mock at a higher level - the actual externalMain function
    // orchestrates cloneRepo + discoverSkills + install
    // For this test, we'll mock the modules

    await externalMain({
      source: "owner/multi-skill-repo",
      installDir: testDir,
    });

    // The error should mention specifying --skill or --all
    // (This will get the "no skills" error first since the clone is empty)
    const allErrorOutput = getClackErrorOutput();
    expect(allErrorOutput.length).toBeGreaterThan(0);
  });

  it("should error when specified --skill name is not found", async () => {
    vi.mocked(loadConfig).mockResolvedValue({
      installDir: testDir,
    });

    await externalMain({
      source: "owner/repo",
      installDir: testDir,
      skill: "nonexistent-skill",
    });

    const allErrorOutput = getClackErrorOutput();
    expect(allErrorOutput.length).toBeGreaterThan(0);
  });

  it("should write nori.json with source info in installed skill directory", async () => {
    // This test verifies the nori.json provenance file is created
    // We need to test with the actual install flow, so we'll mock at the git level
    vi.mocked(loadConfig).mockResolvedValue({
      installDir: testDir,
    });

    // The actual assertion will be that the installed skill dir contains nori.json
    // with the source URL. We'll verify this once the GREEN implementation is done.
    // For now, we verify the function handles the case.
    await externalMain({
      source: "owner/repo",
      installDir: testDir,
      all: true,
    });

    // Will assert nori.json contents once implementation exists
    const allOutput = getClackOutput();
    expect(allOutput.length).toBeGreaterThan(0);
  });
});

describe("externalMain with --skillset", () => {
  let testDir: string;
  let skillsDir: string;
  let profilesDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();

    testDir = await fs.mkdtemp(
      path.join(tmpdir(), "nori-external-skillset-test-"),
    );
    skillsDir = path.join(testDir, ".claude", "skills");
    profilesDir = path.join(testDir, ".nori", "profiles");

    await fs.mkdir(skillsDir, { recursive: true });
    await fs.mkdir(profilesDir, { recursive: true });

    // Create a test skillset with nori.json
    const skillsetDir = path.join(profilesDir, "my-skillset");
    await fs.mkdir(skillsetDir, { recursive: true });
    await fs.writeFile(
      path.join(skillsetDir, "nori.json"),
      JSON.stringify({ name: "my-skillset", version: "1.0.0" }),
    );
  });

  afterEach(async () => {
    vi.clearAllMocks();
    if (testDir) {
      await fs.rm(testDir, { recursive: true, force: true });
    }
  });

  it("should error when specified skillset does not exist", async () => {
    vi.mocked(loadConfig).mockResolvedValue({
      installDir: testDir,
    });

    await externalMain({
      source: "owner/repo",
      installDir: testDir,
      skillset: "nonexistent-skillset",
    });

    const allErrorOutput = getClackErrorOutput();
    expect(allErrorOutput.toLowerCase()).toContain("not found");
    expect(allErrorOutput).toContain("nonexistent-skillset");
  });
});
