/**
 * Tests for the external command - skill type prompting integration
 *
 * Verifies that the external command prompts for inline/extract type
 * and writes the correct type field to per-skill nori.json files.
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

// Mock @clack/prompts
vi.mock("@clack/prompts", () => ({
  select: vi.fn(),
  isCancel: vi.fn(() => false),
  cancel: vi.fn(),
  log: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    step: vi.fn(),
    message: vi.fn(),
  },
}));

// Mock os.homedir so getNoriSkillsetsDir() resolves to the test directory
vi.mock("os", async (importOriginal) => {
  const actual = await importOriginal<typeof os>();
  return {
    ...actual,
    homedir: vi.fn().mockReturnValue(actual.homedir()),
    tmpdir: actual.tmpdir,
  };
});

// Mock the config module
vi.mock("@/cli/config.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    loadConfig: vi.fn(),
    getRegistryAuth: vi.fn(),
    getActiveSkillset: (args: { config: { activeSkillset?: string | null } }) =>
      args.config.activeSkillset ?? null,
    getDefaultAgents: actual.getDefaultAgents,
  };
});

// Capture console output
vi.spyOn(console, "log").mockImplementation(() => undefined);
vi.spyOn(console, "error").mockImplementation(() => undefined);

import { loadConfig } from "@/cli/config.js";

import { externalMain } from "./external.js";

const cancelSymbol = Symbol.for("cancel");

describe("externalMain skill type prompting", () => {
  let testHomeDir: string;
  let testDir: string;
  let skillsDir: string;
  let skillsetsDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();

    testHomeDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "nori-external-type-test-"),
    );
    vi.mocked(os.homedir).mockReturnValue(testHomeDir);

    testDir = testHomeDir;
    skillsDir = path.join(testDir, ".claude", "skills");
    skillsetsDir = path.join(testHomeDir, ".nori", "profiles");

    await fs.mkdir(skillsDir, { recursive: true });
    await fs.mkdir(skillsetsDir, { recursive: true });

    // Create a default skillset
    const skillsetDir = path.join(skillsetsDir, "my-skillset");
    await fs.mkdir(skillsetDir, { recursive: true });
    await fs.writeFile(
      path.join(skillsetDir, "nori.json"),
      JSON.stringify({ name: "my-skillset", version: "1.0.0" }),
    );
  });

  afterEach(async () => {
    vi.clearAllMocks();
    if (testHomeDir) {
      await fs.rm(testHomeDir, { recursive: true, force: true });
    }
  });

  it("should write type: inlined-skill to nori.json when user chooses inline", async () => {
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
        "---\nname: My Skill\ndescription: A skill\n---\n\n# My Skill\n",
      );

      return Buffer.from("");
    });

    // User chooses inline
    vi.mocked(clack.select).mockResolvedValueOnce("inline");

    await externalMain({
      source: "owner/repo",
      installDir: testDir,
      skillset: "my-skillset",
      all: true,
    });

    // Check nori.json in installed skill directory
    const installedNoriJson = JSON.parse(
      await fs.readFile(path.join(skillsDir, "my-skill", "nori.json"), "utf-8"),
    );
    expect(installedNoriJson.type).toBe("inlined-skill");
  });

  it("should write type: skill to nori.json when user chooses extract", async () => {
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
        "---\nname: My Skill\ndescription: A skill\n---\n\n# My Skill\n",
      );

      return Buffer.from("");
    });

    // User chooses extract
    vi.mocked(clack.select).mockResolvedValueOnce("extract");

    await externalMain({
      source: "owner/repo",
      installDir: testDir,
      skillset: "my-skillset",
      all: true,
    });

    const installedNoriJson = JSON.parse(
      await fs.readFile(path.join(skillsDir, "my-skill", "nori.json"), "utf-8"),
    );
    expect(installedNoriJson.type).toBe("skill");
  });

  it("should write type to profile copy nori.json as well", async () => {
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
        "---\nname: My Skill\ndescription: A skill\n---\n\n# My Skill\n",
      );

      return Buffer.from("");
    });

    vi.mocked(clack.select).mockResolvedValueOnce("inline");

    await externalMain({
      source: "owner/repo",
      installDir: testDir,
      skillset: "my-skillset",
      all: true,
    });

    // Check nori.json in profile copy
    const profileNoriJson = JSON.parse(
      await fs.readFile(
        path.join(
          skillsetsDir,
          "my-skillset",
          "skills",
          "my-skill",
          "nori.json",
        ),
        "utf-8",
      ),
    );
    expect(profileNoriJson.type).toBe("inlined-skill");
  });

  it("should not install skills when user cancels type prompt", async () => {
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
        "---\nname: My Skill\ndescription: A skill\n---\n\n# My Skill\n",
      );

      return Buffer.from("");
    });

    // User cancels
    vi.mocked(clack.select).mockResolvedValueOnce(cancelSymbol);
    vi.mocked(clack.isCancel).mockReturnValueOnce(true);

    await externalMain({
      source: "owner/repo",
      installDir: testDir,
      skillset: "my-skillset",
      all: true,
    });

    // Skill directory should not exist
    await expect(fs.access(path.join(skillsDir, "my-skill"))).rejects.toThrow();
  });

  it("should skip type prompt and use skill type when --extract flag is passed", async () => {
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
        "---\nname: My Skill\ndescription: A skill\n---\n\n# My Skill\n",
      );

      return Buffer.from("");
    });

    await externalMain({
      source: "owner/repo",
      installDir: testDir,
      skillset: "my-skillset",
      all: true,
      extract: true,
    });

    // Should not have prompted
    expect(clack.select).not.toHaveBeenCalled();

    const installedNoriJson = JSON.parse(
      await fs.readFile(path.join(skillsDir, "my-skill", "nori.json"), "utf-8"),
    );
    expect(installedNoriJson.type).toBe("skill");
  });

  it("should skip type prompt and use inlined-skill type when --inline flag is passed", async () => {
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
        "---\nname: My Skill\ndescription: A skill\n---\n\n# My Skill\n",
      );

      return Buffer.from("");
    });

    await externalMain({
      source: "owner/repo",
      installDir: testDir,
      skillset: "my-skillset",
      all: true,
      inline: true,
    });

    // Should not have prompted
    expect(clack.select).not.toHaveBeenCalled();

    const installedNoriJson = JSON.parse(
      await fs.readFile(path.join(skillsDir, "my-skill", "nori.json"), "utf-8"),
    );
    expect(installedNoriJson.type).toBe("inlined-skill");
  });

  it("should prompt with batch choice when multiple skills are discovered", async () => {
    vi.mocked(loadConfig).mockResolvedValue({
      installDir: testDir,
    });

    vi.mocked(execFileSync).mockImplementation((_cmd, args) => {
      const gitArgs = args as Array<string>;
      const destDir = gitArgs[gitArgs.length - 1];

      const skillDirA = path.join(destDir, "skills", "skill-a");
      fsSync.mkdirSync(skillDirA, { recursive: true });
      fsSync.writeFileSync(
        path.join(skillDirA, "SKILL.md"),
        "---\nname: Skill A\ndescription: First skill\n---\n\n# Skill A\n",
      );

      const skillDirB = path.join(destDir, "skills", "skill-b");
      fsSync.mkdirSync(skillDirB, { recursive: true });
      fsSync.writeFileSync(
        path.join(skillDirB, "SKILL.md"),
        "---\nname: Skill B\ndescription: Second skill\n---\n\n# Skill B\n",
      );

      return Buffer.from("");
    });

    // Batch: all-same -> extract
    vi.mocked(clack.select)
      .mockResolvedValueOnce("all-same")
      .mockResolvedValueOnce("extract");

    await externalMain({
      source: "owner/repo",
      installDir: testDir,
      skillset: "my-skillset",
      all: true,
    });

    const noriJsonA = JSON.parse(
      await fs.readFile(path.join(skillsDir, "skill-a", "nori.json"), "utf-8"),
    );
    const noriJsonB = JSON.parse(
      await fs.readFile(path.join(skillsDir, "skill-b", "nori.json"), "utf-8"),
    );
    expect(noriJsonA.type).toBe("skill");
    expect(noriJsonB.type).toBe("skill");
  });
});
