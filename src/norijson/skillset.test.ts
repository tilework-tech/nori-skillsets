/**
 * Tests for norijson/skillset: paths, parseSkillset, and listSkillsets
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { describe, it, test, expect, beforeEach, afterEach, vi } from "vitest";

// Mock os.homedir so getNoriSkillsetsDir() resolves to test directories
vi.mock("os", async (importOriginal) => {
  const actual = await importOriginal<typeof os>();
  return {
    ...actual,
    homedir: vi.fn().mockReturnValue(actual.homedir()),
  };
});

import {
  getNoriDir,
  getNoriSkillsetsDir,
  parseSkillset,
  listSkillsets,
} from "@/norijson/skillset.js";

describe("Shared Nori paths", () => {
  describe("getNoriDir", () => {
    it("should return ~/.nori", () => {
      const result = getNoriDir();
      expect(result).toBe(path.join(os.homedir(), ".nori"));
    });
  });

  describe("getNoriSkillsetsDir", () => {
    it("should return ~/.nori/profiles", () => {
      const result = getNoriSkillsetsDir();
      expect(result).toBe(path.join(os.homedir(), ".nori", "profiles"));
    });
  });
});

describe("parseSkillset", () => {
  let tempDir: string;
  let profilesDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "skillset-parse-test-"));
    const mockNoriDir = path.join(tempDir, ".nori");
    profilesDir = path.join(mockNoriDir, "profiles");
    await fs.mkdir(profilesDir, { recursive: true });
    vi.mocked(os.homedir).mockReturnValue(tempDir);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("should parse a fully-populated skillset directory with AGENTS.md", async () => {
    const skillsetName = "full-skillset";
    const skillsetDir = path.join(profilesDir, skillsetName);
    await fs.mkdir(skillsetDir, { recursive: true });
    await fs.writeFile(
      path.join(skillsetDir, "nori.json"),
      JSON.stringify({
        name: "full-skillset",
        version: "1.0.0",
        type: "skillset",
      }),
    );
    await fs.writeFile(path.join(skillsetDir, "AGENTS.md"), "# My Profile\n");
    await fs.mkdir(path.join(skillsetDir, "skills"), { recursive: true });
    await fs.mkdir(path.join(skillsetDir, "slashcommands"), {
      recursive: true,
    });
    await fs.mkdir(path.join(skillsetDir, "subagents"), { recursive: true });

    const skillset = await parseSkillset({ skillsetName });

    expect(skillset.name).toBe("full-skillset");
    expect(skillset.dir).toBe(skillsetDir);
    expect(skillset.metadata.name).toBe("full-skillset");
    expect(skillset.metadata.version).toBe("1.0.0");
    expect(skillset.skillsDir).toBe(path.join(skillsetDir, "skills"));
    expect(skillset.configFilePath).toBe(path.join(skillsetDir, "AGENTS.md"));
    expect(skillset.slashcommandsDir).toBe(
      path.join(skillsetDir, "slashcommands"),
    );
    expect(skillset.subagentsDir).toBe(path.join(skillsetDir, "subagents"));
  });

  it("should parse a minimal skillset with only nori.json", async () => {
    const skillsetName = "minimal-skillset";
    const skillsetDir = path.join(profilesDir, skillsetName);
    await fs.mkdir(skillsetDir, { recursive: true });
    await fs.writeFile(
      path.join(skillsetDir, "nori.json"),
      JSON.stringify({
        name: "minimal-skillset",
        version: "0.1.0",
      }),
    );

    const skillset = await parseSkillset({ skillsetName });

    expect(skillset.name).toBe("minimal-skillset");
    expect(skillset.dir).toBe(skillsetDir);
    expect(skillset.metadata.name).toBe("minimal-skillset");
    expect(skillset.skillsDir).toBeNull();
    expect(skillset.configFilePath).toBeNull();
    expect(skillset.slashcommandsDir).toBeNull();
    expect(skillset.subagentsDir).toBeNull();
  });

  it("should handle namespaced skillsets like org/name", async () => {
    const skillsetName = "myorg/my-skillset";
    const skillsetDir = path.join(profilesDir, "myorg", "my-skillset");
    await fs.mkdir(skillsetDir, { recursive: true });
    await fs.writeFile(
      path.join(skillsetDir, "nori.json"),
      JSON.stringify({
        name: "myorg/my-skillset",
        version: "1.0.0",
      }),
    );
    await fs.writeFile(path.join(skillsetDir, "AGENTS.md"), "# Org Profile\n");

    const skillset = await parseSkillset({ skillsetName });

    expect(skillset.name).toBe("myorg/my-skillset");
    expect(skillset.dir).toBe(skillsetDir);
    expect(skillset.configFilePath).toBe(path.join(skillsetDir, "AGENTS.md"));
  });

  it("should throw when skillset directory does not exist", async () => {
    await expect(
      parseSkillset({ skillsetName: "nonexistent" }),
    ).rejects.toThrow();
  });

  it("should throw when nori.json is missing and directory doesn't look like a skillset", async () => {
    const skillsetName = "no-manifest";
    const skillsetDir = path.join(profilesDir, skillsetName);
    await fs.mkdir(skillsetDir, { recursive: true });
    await fs.writeFile(path.join(skillsetDir, "readme.txt"), "not a skillset");

    await expect(parseSkillset({ skillsetName })).rejects.toThrow();
  });

  it("should fall back to CLAUDE.md when AGENTS.md does not exist", async () => {
    const skillsetName = "legacy-skillset";
    const skillsetDir = path.join(profilesDir, skillsetName);
    await fs.mkdir(skillsetDir, { recursive: true });
    await fs.writeFile(
      path.join(skillsetDir, "CLAUDE.md"),
      "# Legacy Profile\n",
    );

    const skillset = await parseSkillset({ skillsetName });

    expect(skillset.name).toBe("legacy-skillset");
    expect(skillset.metadata.version).toBe("0.0.1");
    expect(skillset.configFilePath).toBe(path.join(skillsetDir, "CLAUDE.md"));
  });

  it("should prefer AGENTS.md over CLAUDE.md when both exist", async () => {
    const skillsetName = "both-files";
    const skillsetDir = path.join(profilesDir, skillsetName);
    await fs.mkdir(skillsetDir, { recursive: true });
    await fs.writeFile(
      path.join(skillsetDir, "nori.json"),
      JSON.stringify({
        name: "both-files",
        version: "1.0.0",
        type: "skillset",
      }),
    );
    await fs.writeFile(path.join(skillsetDir, "AGENTS.md"), "# New\n");
    await fs.writeFile(path.join(skillsetDir, "CLAUDE.md"), "# Old\n");

    const skillset = await parseSkillset({ skillsetName });

    expect(skillset.configFilePath).toBe(path.join(skillsetDir, "AGENTS.md"));
  });

  it("should detect partial skillset with only skills dir", async () => {
    const skillsetName = "skills-only";
    const skillsetDir = path.join(profilesDir, skillsetName);
    await fs.mkdir(skillsetDir, { recursive: true });
    await fs.writeFile(
      path.join(skillsetDir, "nori.json"),
      JSON.stringify({ name: "skills-only", version: "1.0.0" }),
    );
    await fs.mkdir(path.join(skillsetDir, "skills"), { recursive: true });

    const skillset = await parseSkillset({ skillsetName });

    expect(skillset.skillsDir).toBe(path.join(skillsetDir, "skills"));
    expect(skillset.configFilePath).toBeNull();
    expect(skillset.slashcommandsDir).toBeNull();
    expect(skillset.subagentsDir).toBeNull();
  });

  it("should also accept a direct skillsetDir path", async () => {
    const skillsetDir = path.join(profilesDir, "direct-path");
    await fs.mkdir(skillsetDir, { recursive: true });
    await fs.writeFile(
      path.join(skillsetDir, "nori.json"),
      JSON.stringify({ name: "direct-path", version: "1.0.0" }),
    );

    const skillset = await parseSkillset({ skillsetDir });

    expect(skillset.name).toBe("direct-path");
    expect(skillset.dir).toBe(skillsetDir);
  });
});

describe("listSkillsets", () => {
  let testHomeDir: string;

  beforeEach(async () => {
    testHomeDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "managed-folder-test-"),
    );
    vi.mocked(os.homedir).mockReturnValue(testHomeDir);
  });

  afterEach(async () => {
    if (testHomeDir) {
      await fs.rm(testHomeDir, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  test("returns empty array when no profiles directory exists", async () => {
    const profiles = await listSkillsets();

    expect(profiles).toEqual([]);
  });

  test("returns empty array when profiles directory is empty", async () => {
    const skillsetsDir = path.join(testHomeDir, ".nori", "profiles");
    await fs.mkdir(skillsetsDir, { recursive: true });

    const profiles = await listSkillsets();

    expect(profiles).toEqual([]);
  });

  test("returns profile names for directories containing nori.json", async () => {
    const skillsetsDir = path.join(testHomeDir, ".nori", "profiles");

    // Create valid profiles (with nori.json)
    for (const name of ["amol", "senior-swe"]) {
      const dir = path.join(skillsetsDir, name);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(
        path.join(dir, "nori.json"),
        JSON.stringify({ name, version: "1.0.0" }),
      );
    }

    // Create invalid profile (no nori.json)
    const invalidDir = path.join(skillsetsDir, "invalid-profile");
    await fs.mkdir(invalidDir, { recursive: true });
    await fs.writeFile(path.join(invalidDir, "readme.txt"), "not a profile");

    const profiles = await listSkillsets();

    expect(profiles).toContain("amol");
    expect(profiles).toContain("senior-swe");
    expect(profiles).not.toContain("invalid-profile");
    expect(profiles.length).toBe(2);
  });

  test("returns namespaced profiles in nested directories", async () => {
    const skillsetsDir = path.join(testHomeDir, ".nori", "profiles");

    // Create flat profile (e.g., profiles/amol)
    const flatDir = path.join(skillsetsDir, "amol");
    await fs.mkdir(flatDir, { recursive: true });
    await fs.writeFile(
      path.join(flatDir, "nori.json"),
      JSON.stringify({ name: "amol", version: "1.0.0" }),
    );

    // Create org directory with nested profiles (e.g., profiles/myorg/my-profile)
    const orgDir = path.join(skillsetsDir, "myorg");
    const nestedProfile1 = path.join(orgDir, "my-profile");
    const nestedProfile2 = path.join(orgDir, "other-profile");
    await fs.mkdir(nestedProfile1, { recursive: true });
    await fs.mkdir(nestedProfile2, { recursive: true });
    await fs.writeFile(
      path.join(nestedProfile1, "nori.json"),
      JSON.stringify({ name: "myorg/my-profile", version: "1.0.0" }),
    );
    await fs.writeFile(
      path.join(nestedProfile2, "nori.json"),
      JSON.stringify({ name: "myorg/other-profile", version: "1.0.0" }),
    );

    const profiles = await listSkillsets();

    expect(profiles).toContain("amol");
    expect(profiles).toContain("myorg/my-profile");
    expect(profiles).toContain("myorg/other-profile");
    expect(profiles.length).toBe(3);
  });

  test("org directory without nori.json is treated as org, not profile", async () => {
    const skillsetsDir = path.join(testHomeDir, ".nori", "profiles");

    // Create org directory without nori.json but with nested profile
    const orgDir = path.join(skillsetsDir, "myorg");
    const nestedProfile = path.join(orgDir, "my-profile");
    await fs.mkdir(nestedProfile, { recursive: true });
    await fs.writeFile(
      path.join(nestedProfile, "nori.json"),
      JSON.stringify({ name: "myorg/my-profile", version: "1.0.0" }),
    );

    // Also create readme.txt in org dir to simulate a non-profile directory
    await fs.writeFile(path.join(orgDir, "readme.txt"), "org readme");

    const profiles = await listSkillsets();

    // Should only include the nested profile, not the org directory itself
    expect(profiles).toContain("myorg/my-profile");
    expect(profiles).not.toContain("myorg");
    expect(profiles.length).toBe(1);
  });

  test("auto-creates nori.json for flat profile with AGENTS.md but no nori.json", async () => {
    const skillsetsDir = path.join(testHomeDir, ".nori", "profiles");

    // Create a user-made profile with AGENTS.md but no nori.json
    const skillsetDir = path.join(skillsetsDir, "my-custom-profile");
    await fs.mkdir(skillsetDir, { recursive: true });
    await fs.writeFile(path.join(skillsetDir, "AGENTS.md"), "# My Profile");

    const profiles = await listSkillsets();

    expect(profiles).toContain("my-custom-profile");

    // Verify nori.json was auto-created with correct defaults
    const noriJson = JSON.parse(
      await fs.readFile(path.join(skillsetDir, "nori.json"), "utf-8"),
    );
    expect(noriJson.name).toBe("my-custom-profile");
    expect(noriJson.version).toBe("0.0.1");
  });

  test("auto-creates nori.json for flat profile with CLAUDE.md but no nori.json (backward compat)", async () => {
    const skillsetsDir = path.join(testHomeDir, ".nori", "profiles");

    // Create a user-made profile with CLAUDE.md but no nori.json
    const skillsetDir = path.join(skillsetsDir, "legacy-profile");
    await fs.mkdir(skillsetDir, { recursive: true });
    await fs.writeFile(path.join(skillsetDir, "CLAUDE.md"), "# My Profile");

    const profiles = await listSkillsets();

    expect(profiles).toContain("legacy-profile");
  });

  test("auto-creates nori.json for flat profile with skills and subagents dirs but no nori.json", async () => {
    const skillsetsDir = path.join(testHomeDir, ".nori", "profiles");

    // Create a profile with skills/ and subagents/ but no nori.json
    const skillsetDir = path.join(skillsetsDir, "dev-profile");
    await fs.mkdir(path.join(skillsetDir, "skills"), { recursive: true });
    await fs.mkdir(path.join(skillsetDir, "subagents"), { recursive: true });

    const profiles = await listSkillsets();

    expect(profiles).toContain("dev-profile");

    // Verify nori.json was auto-created
    const noriJson = JSON.parse(
      await fs.readFile(path.join(skillsetDir, "nori.json"), "utf-8"),
    );
    expect(noriJson.name).toBe("dev-profile");
    expect(noriJson.version).toBe("0.0.1");
  });

  test("does not auto-create nori.json for directories without profile markers", async () => {
    const skillsetsDir = path.join(testHomeDir, ".nori", "profiles");

    // Create a directory with no profile markers
    const randomDir = path.join(skillsetsDir, "random-dir");
    await fs.mkdir(randomDir, { recursive: true });
    await fs.writeFile(path.join(randomDir, "readme.txt"), "not a profile");

    const profiles = await listSkillsets();

    expect(profiles).not.toContain("random-dir");
    await expect(
      fs.access(path.join(randomDir, "nori.json")),
    ).rejects.toThrow();
  });

  test("does not auto-create nori.json in org directory, preserving nested profile discovery", async () => {
    const skillsetsDir = path.join(testHomeDir, ".nori", "profiles");

    // Create org directory without nori.json, with a nested profile that has AGENTS.md
    const orgDir = path.join(skillsetsDir, "myorg");
    const nestedProfile = path.join(orgDir, "team-profile");
    await fs.mkdir(nestedProfile, { recursive: true });
    await fs.writeFile(path.join(nestedProfile, "AGENTS.md"), "# Team Profile");

    const profiles = await listSkillsets();

    // Nested profile should be discovered via auto-created nori.json
    expect(profiles).toContain("myorg/team-profile");
    // Org directory should NOT become a flat profile
    expect(profiles).not.toContain("myorg");
    // Org directory should NOT have nori.json created
    await expect(fs.access(path.join(orgDir, "nori.json"))).rejects.toThrow();
  });
});
