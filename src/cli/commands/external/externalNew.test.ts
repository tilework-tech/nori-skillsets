/**
 * Tests for the external command --new flag
 *
 * Verifies that --new creates a new skillset directory with nori.json,
 * then installs discovered skills into it.
 */

import { execFileSync } from "child_process";
import * as fsSync from "fs";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import * as clack from "@clack/prompts";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock child_process for git clone
vi.mock("child_process", () => ({
  execFileSync: vi.fn(),
}));

// Mock @clack/prompts to prevent interactive prompts from hanging
vi.mock("@clack/prompts", () => ({
  select: vi.fn(),
  isCancel: vi.fn(() => false),
  cancel: vi.fn(),
}));

// Mock os.homedir so getNoriProfilesDir() resolves to the test directory
vi.mock("os", async (importOriginal) => {
  const actual = await importOriginal<typeof os>();
  return {
    ...actual,
    homedir: vi.fn().mockReturnValue(actual.homedir()),
    tmpdir: actual.tmpdir,
  };
});

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
    getDefaultAgent: (args: {
      config: {
        defaultAgents?: Array<string> | null;
        agents?: Record<string, unknown> | null;
      };
      agentOverride?: string | null;
    }) => {
      if (args.agentOverride != null && args.agentOverride !== "")
        return args.agentOverride;
      if (
        args.config.defaultAgents != null &&
        args.config.defaultAgents.length > 0
      )
        return args.config.defaultAgents[0];
      const agents = Object.keys(args.config.agents ?? {});
      return agents.length > 0 ? agents[0] : "claude-code";
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

vi.mock("@clack/prompts", () => ({
  log: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    step: vi.fn(),
    message: vi.fn(),
  },
  spinner: vi.fn(() => ({
    start: vi.fn(),
    stop: vi.fn(),
    message: "",
  })),
  confirm: vi.fn(),
  text: vi.fn(),
  select: vi.fn(),
  isCancel: vi.fn(),
}));

vi.mock("@/cli/logger.js", () => ({
  debug: vi.fn(),
  setSilentMode: vi.fn(),
  isSilentMode: vi.fn(),
}));

/**
 * Collect all clack output (log.error, log.success, log.info, log.warn)
 * into a single string for assertion convenience.
 *
 * @returns Combined clack output as a single string
 */
const getAllClackOutput = (): string => {
  const parts: Array<string> = [];
  for (const fn of [
    clack.log.error,
    clack.log.success,
    clack.log.info,
    clack.log.warn,
    clack.log.message,
  ]) {
    const mock = vi.mocked(fn);
    for (const call of mock.mock.calls) {
      parts.push(call.map(String).join(" "));
    }
  }
  return parts.join("\n");
};

/**
 * Collect all clack error output (log.error calls) into a single string.
 *
 * @returns Combined clack error output as a single string
 */
const getClackErrorOutput = (): string => {
  const mock = vi.mocked(clack.log.error);
  return mock.mock.calls.map((call) => call.map(String).join(" ")).join("\n");
};

import { loadConfig } from "@/cli/config.js";

import { externalMain } from "./external.js";

describe("externalMain with --new", () => {
  let testHomeDir: string;
  let testDir: string;
  let skillsDir: string;
  let profilesDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();

    testHomeDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "nori-external-new-test-"),
    );
    vi.mocked(os.homedir).mockReturnValue(testHomeDir);

    testDir = testHomeDir;
    skillsDir = path.join(testDir, ".claude", "skills");
    profilesDir = path.join(testHomeDir, ".nori", "profiles");

    await fs.mkdir(skillsDir, { recursive: true });
    await fs.mkdir(profilesDir, { recursive: true });
  });

  afterEach(async () => {
    vi.clearAllMocks();
    if (testHomeDir) {
      await fs.rm(testHomeDir, { recursive: true, force: true });
    }
  });

  it("should error when both --new and --skillset are provided", async () => {
    vi.mocked(loadConfig).mockResolvedValue({
      installDir: testDir,
    });

    await externalMain({
      source: "owner/repo",
      installDir: testDir,
      newSkillset: "my-new-skillset",
      skillset: "existing-skillset",
    });

    const allErrorOutput = getClackErrorOutput();
    expect(allErrorOutput.toLowerCase()).toContain(
      "cannot use --new and --skillset together",
    );
  });

  it("should error when --new name is empty or whitespace", async () => {
    vi.mocked(loadConfig).mockResolvedValue({
      installDir: testDir,
    });

    await externalMain({
      source: "owner/repo",
      installDir: testDir,
      newSkillset: "   ",
    });

    const allErrorOutput = getClackErrorOutput();
    expect(allErrorOutput.toLowerCase()).toContain("name");
  });

  it("should error when --new skillset already exists", async () => {
    // Create an existing skillset
    const existingDir = path.join(profilesDir, "existing");
    await fs.mkdir(existingDir, { recursive: true });
    await fs.writeFile(
      path.join(existingDir, "nori.json"),
      JSON.stringify({ name: "existing", version: "1.0.0" }),
    );

    vi.mocked(loadConfig).mockResolvedValue({
      installDir: testDir,
    });

    await externalMain({
      source: "owner/repo",
      installDir: testDir,
      newSkillset: "existing",
    });

    const allErrorOutput = getClackErrorOutput();
    expect(allErrorOutput.toLowerCase()).toContain("already exists");
  });

  it("should create skillset directory with nori.json when cloning succeeds", async () => {
    vi.mocked(loadConfig).mockResolvedValue({
      installDir: testDir,
    });

    // Mock execFileSync to simulate a successful clone that creates a SKILL.md
    vi.mocked(execFileSync).mockImplementation((_cmd, args) => {
      // The last argument to git clone is the destination directory
      const gitArgs = args as Array<string>;
      const destDir = gitArgs[gitArgs.length - 1];

      // Create a skill in the cloned dir
      const skillDir = path.join(destDir, "skills", "test-skill");
      fsSync.mkdirSync(skillDir, { recursive: true });
      fsSync.writeFileSync(
        path.join(skillDir, "SKILL.md"),
        "---\nname: Test Skill\ndescription: A test skill\n---\n\n# Test Skill\n",
      );

      return Buffer.from("");
    });

    await externalMain({
      source: "owner/repo",
      installDir: testDir,
      newSkillset: "fresh-skillset",
      all: true,
      extract: true,
    });

    // Verify skillset directory was created with nori.json
    const skillsetDir = path.join(profilesDir, "fresh-skillset");

    // Verify nori.json was created with correct structure
    const noriJsonContent = JSON.parse(
      await fs.readFile(path.join(skillsetDir, "nori.json"), "utf-8"),
    );
    expect(noriJsonContent.name).toBe("fresh-skillset");
    expect(noriJsonContent.version).toBe("1.0.0");

    // Verify the skill was installed into the profile's skills directory
    const profileSkillDir = path.join(skillsetDir, "skills", "test-skill");
    const skillMd = await fs.readFile(
      path.join(profileSkillDir, "SKILL.md"),
      "utf-8",
    );
    expect(skillMd).toContain("Test Skill");

    // Verify success message about creating the skillset was printed via clack
    const allOutput = getAllClackOutput();
    expect(allOutput.toLowerCase()).toContain("created");
    expect(allOutput).toContain("fresh-skillset");
  });

  it("should add skill dependencies to the new skillset's nori.json", async () => {
    vi.mocked(loadConfig).mockResolvedValue({
      installDir: testDir,
    });

    vi.mocked(execFileSync).mockImplementation((_cmd, args) => {
      const gitArgs = args as Array<string>;
      const destDir = gitArgs[gitArgs.length - 1];

      const skillDir = path.join(destDir, "skills", "my-skill");
      fsSync.mkdirSync(skillDir, { recursive: true });
      fsSync.writeFileSync(
        path.join(skillDir, "SKILL.md"),
        "---\nname: My Skill\ndescription: Does things\n---\n\n# My Skill\n",
      );

      return Buffer.from("");
    });

    await externalMain({
      source: "owner/repo",
      installDir: testDir,
      newSkillset: "deps-test",
      all: true,
      extract: true,
    });

    const skillsetDir = path.join(profilesDir, "deps-test");
    const noriJsonContent = JSON.parse(
      await fs.readFile(path.join(skillsetDir, "nori.json"), "utf-8"),
    );

    // The skill should be added as a dependency
    expect(noriJsonContent.dependencies).toBeDefined();
    expect(noriJsonContent.dependencies.skills).toBeDefined();
    expect(noriJsonContent.dependencies.skills["my-skill"]).toBe("*");
  });
});
