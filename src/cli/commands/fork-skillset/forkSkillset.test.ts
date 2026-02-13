/**
 * Tests for fork-skillset command
 * Tests that the command correctly copies an existing skillset to a new name
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { forkSkillsetMain } from "./forkSkillset.js";

// Mock os.homedir so getNoriProfilesDir() resolves to the test directory
vi.mock("os", async (importOriginal) => {
  const actual = await importOriginal<typeof os>();
  return {
    ...actual,
    homedir: vi.fn().mockReturnValue(actual.homedir()),
  };
});

// Mock @clack/prompts for output
const mockLogError = vi.fn();
const mockNote = vi.fn();
const mockOutro = vi.fn();
vi.mock("@clack/prompts", () => ({
  log: {
    error: (msg: string) => mockLogError(msg),
  },
  note: (content: string, title: string) => mockNote(content, title),
  outro: (msg: string) => mockOutro(msg),
}));

// Mock process.exit
const mockExit = vi
  .spyOn(process, "exit")
  .mockImplementation(() => undefined as never);

describe("forkSkillsetMain", () => {
  let testHomeDir: string;
  let profilesDir: string;

  beforeEach(async () => {
    testHomeDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "fork-skillset-test-"),
    );
    vi.mocked(os.homedir).mockReturnValue(testHomeDir);
    profilesDir = path.join(testHomeDir, ".nori", "profiles");
    await fs.mkdir(profilesDir, { recursive: true });
    mockLogError.mockClear();
    mockNote.mockClear();
    mockOutro.mockClear();
    mockExit.mockClear();
  });

  afterEach(async () => {
    if (testHomeDir) {
      await fs.rm(testHomeDir, { recursive: true, force: true });
    }
  });

  it("should copy a flat skillset to a new name with all contents", async () => {
    // Create source skillset with multiple files/directories
    const sourceDir = path.join(profilesDir, "senior-swe");
    await fs.mkdir(sourceDir, { recursive: true });
    await fs.writeFile(
      path.join(sourceDir, "nori.json"),
      JSON.stringify({ name: "senior-swe", version: "1.0.0" }),
    );
    const skillsDir = path.join(sourceDir, "skills", "my-skill");
    await fs.mkdir(skillsDir, { recursive: true });
    await fs.writeFile(path.join(skillsDir, "SKILL.md"), "# My Skill");

    await forkSkillsetMain({
      baseSkillset: "senior-swe",
      newSkillset: "my-custom",
    });

    // Verify destination exists with all contents
    const destDir = path.join(profilesDir, "my-custom");

    const skillMd = await fs.readFile(
      path.join(destDir, "skills", "my-skill", "SKILL.md"),
      "utf-8",
    );
    expect(skillMd).toBe("# My Skill");

    const noriJson = await fs.readFile(
      path.join(destDir, "nori.json"),
      "utf-8",
    );
    expect(noriJson).toBe(
      JSON.stringify({ name: "senior-swe", version: "1.0.0" }),
    );

    // Verify outro message contains both source and destination
    expect(mockOutro).toHaveBeenCalledWith(
      expect.stringContaining("senior-swe"),
    );
    expect(mockOutro).toHaveBeenCalledWith(
      expect.stringContaining("my-custom"),
    );
    expect(mockExit).not.toHaveBeenCalled();
  });

  it("should error when base skillset does not exist", async () => {
    await forkSkillsetMain({
      baseSkillset: "nonexistent",
      newSkillset: "my-copy",
    });

    expect(mockLogError).toHaveBeenCalledWith(
      expect.stringContaining("nonexistent"),
    );
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("should error when base skillset directory exists but has no nori.json", async () => {
    // Create a directory that is not a valid skillset
    const invalidDir = path.join(profilesDir, "not-a-skillset");
    await fs.mkdir(invalidDir, { recursive: true });
    await fs.writeFile(path.join(invalidDir, "readme.txt"), "not a profile");

    await forkSkillsetMain({
      baseSkillset: "not-a-skillset",
      newSkillset: "my-copy",
    });

    expect(mockLogError).toHaveBeenCalledWith(
      expect.stringContaining("not-a-skillset"),
    );
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("should error when destination skillset already exists", async () => {
    // Create source
    const sourceDir = path.join(profilesDir, "base-profile");
    await fs.mkdir(sourceDir, { recursive: true });
    await fs.writeFile(
      path.join(sourceDir, "nori.json"),
      JSON.stringify({ name: "base-profile", version: "1.0.0" }),
    );

    // Create destination that already exists
    const destDir = path.join(profilesDir, "existing-profile");
    await fs.mkdir(destDir, { recursive: true });
    await fs.writeFile(
      path.join(destDir, "nori.json"),
      JSON.stringify({ name: "existing-profile", version: "1.0.0" }),
    );

    await forkSkillsetMain({
      baseSkillset: "base-profile",
      newSkillset: "existing-profile",
    });

    expect(mockLogError).toHaveBeenCalledWith(
      expect.stringContaining("existing-profile"),
    );
    expect(mockLogError).toHaveBeenCalledWith(
      expect.stringContaining("already exists"),
    );
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("should work with namespaced profile names", async () => {
    // Create a namespaced source skillset
    const sourceDir = path.join(profilesDir, "myorg", "base-profile");
    await fs.mkdir(sourceDir, { recursive: true });
    await fs.writeFile(
      path.join(sourceDir, "nori.json"),
      JSON.stringify({ name: "base-profile", version: "1.0.0" }),
    );

    await forkSkillsetMain({
      baseSkillset: "myorg/base-profile",
      newSkillset: "myorg/forked-profile",
    });

    // Verify destination exists
    const destDir = path.join(profilesDir, "myorg", "forked-profile");
    const noriJson = await fs.readFile(
      path.join(destDir, "nori.json"),
      "utf-8",
    );
    expect(noriJson).toBe(
      JSON.stringify({ name: "base-profile", version: "1.0.0" }),
    );
    expect(mockExit).not.toHaveBeenCalled();
  });

  it("should create parent directory for namespaced destination", async () => {
    // Create a flat source
    const sourceDir = path.join(profilesDir, "senior-swe");
    await fs.mkdir(sourceDir, { recursive: true });
    await fs.writeFile(
      path.join(sourceDir, "nori.json"),
      JSON.stringify({ name: "senior-swe", version: "1.0.0" }),
    );

    // Fork to a new org namespace that doesn't exist yet
    await forkSkillsetMain({
      baseSkillset: "senior-swe",
      newSkillset: "neworg/my-fork",
    });

    const destDir = path.join(profilesDir, "neworg", "my-fork");
    const noriJson = await fs.readFile(
      path.join(destDir, "nori.json"),
      "utf-8",
    );
    expect(noriJson).toBe(
      JSON.stringify({ name: "senior-swe", version: "1.0.0" }),
    );
    expect(mockExit).not.toHaveBeenCalled();
  });

  it("should print instructions for switching and editing after fork", async () => {
    const sourceDir = path.join(profilesDir, "senior-swe");
    await fs.mkdir(sourceDir, { recursive: true });
    await fs.writeFile(
      path.join(sourceDir, "nori.json"),
      JSON.stringify({ name: "senior-swe", version: "1.0.0" }),
    );

    await forkSkillsetMain({
      baseSkillset: "senior-swe",
      newSkillset: "my-fork",
    });

    // Should show note with next steps containing switch and edit instructions
    expect(mockNote).toHaveBeenCalledWith(
      expect.stringContaining("switch my-fork"),
      "Next Steps",
    );
    expect(mockNote).toHaveBeenCalledWith(
      expect.stringContaining("~/.nori/profiles/my-fork"),
      "Next Steps",
    );
  });
});
