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
  resolveSkillsetDir,
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

  it("resolves a bare name to a profile stored in the personal bucket", async () => {
    const skillsetDir = path.join(profilesDir, "personal", "bucketed");
    await fs.mkdir(skillsetDir, { recursive: true });
    await fs.writeFile(
      path.join(skillsetDir, "nori.json"),
      JSON.stringify({ name: "bucketed", version: "1.0.0" }),
    );

    const skillset = await parseSkillset({ skillsetName: "bucketed" });

    expect(skillset.dir).toBe(skillsetDir);
    expect(skillset.name).toBe("bucketed");
  });

  it("prefers the personal bucket over the public bucket for a bare name", async () => {
    const personalDir = path.join(profilesDir, "personal", "dup");
    const publicDir = path.join(profilesDir, "public", "dup");
    await fs.mkdir(personalDir, { recursive: true });
    await fs.mkdir(publicDir, { recursive: true });
    await fs.writeFile(
      path.join(personalDir, "nori.json"),
      JSON.stringify({ name: "dup", version: "1.0.0" }),
    );
    await fs.writeFile(
      path.join(publicDir, "nori.json"),
      JSON.stringify({ name: "dup", version: "2.0.0" }),
    );

    const skillset = await parseSkillset({ skillsetName: "dup" });

    expect(skillset.dir).toBe(personalDir);
  });

  it("resolves an explicit public/<name> reference to the public bucket", async () => {
    const publicDir = path.join(profilesDir, "public", "explicit");
    await fs.mkdir(publicDir, { recursive: true });
    await fs.writeFile(
      path.join(publicDir, "nori.json"),
      JSON.stringify({ name: "explicit", version: "1.0.0" }),
    );

    const skillset = await parseSkillset({ skillsetName: "public/explicit" });

    expect(skillset.dir).toBe(publicDir);
  });

  it("still resolves a legacy bare profile that has not been migrated", async () => {
    const legacyDir = path.join(profilesDir, "legacy-bare");
    await fs.mkdir(legacyDir, { recursive: true });
    await fs.writeFile(
      path.join(legacyDir, "nori.json"),
      JSON.stringify({ name: "legacy-bare", version: "1.0.0" }),
    );

    const skillset = await parseSkillset({ skillsetName: "legacy-bare" });

    expect(skillset.dir).toBe(legacyDir);
  });

  describe("resolveSkillsetDir", () => {
    it("returns null for a name that exists nowhere", async () => {
      const resolved = await resolveSkillsetDir({ name: "ghost" });
      expect(resolved).toBeNull();
    });

    it("resolves an org-namespaced name directly", async () => {
      const orgDir = path.join(profilesDir, "acme", "sessions");
      await fs.mkdir(orgDir, { recursive: true });
      await fs.writeFile(
        path.join(orgDir, "nori.json"),
        JSON.stringify({ name: "acme/sessions", version: "1.0.0" }),
      );

      const resolved = await resolveSkillsetDir({ name: "acme/sessions" });

      expect(resolved).toBe(orgDir);
    });

    it("does not resolve a bare bucket name to the bucket directory", async () => {
      // The personal/ bucket directory exists (it holds a skillset)...
      const inside = path.join(profilesDir, "personal", "foo");
      await fs.mkdir(inside, { recursive: true });
      await fs.writeFile(
        path.join(inside, "nori.json"),
        JSON.stringify({ name: "foo", version: "1.0.0" }),
      );

      // ...but "personal" itself is not a skillset.
      expect(await resolveSkillsetDir({ name: "personal" })).toBeNull();
    });
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

  it("should populate mcpDir when skillset has an mcp directory", async () => {
    const skillsetName = "with-mcp";
    const skillsetDir = path.join(profilesDir, skillsetName);
    await fs.mkdir(skillsetDir, { recursive: true });
    await fs.writeFile(
      path.join(skillsetDir, "nori.json"),
      JSON.stringify({ name: "with-mcp", version: "1.0.0" }),
    );
    await fs.mkdir(path.join(skillsetDir, "mcp"), { recursive: true });

    const skillset = await parseSkillset({ skillsetName });

    expect(skillset.mcpDir).toBe(path.join(skillsetDir, "mcp"));
  });

  it("should set mcpDir to null when no mcp directory exists", async () => {
    const skillsetName = "no-mcp";
    const skillsetDir = path.join(profilesDir, skillsetName);
    await fs.mkdir(skillsetDir, { recursive: true });
    await fs.writeFile(
      path.join(skillsetDir, "nori.json"),
      JSON.stringify({ name: "no-mcp", version: "1.0.0" }),
    );

    const skillset = await parseSkillset({ skillsetName });

    expect(skillset.mcpDir).toBeNull();
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

  test("lists legacy skillsets without writing nori.json to them", async () => {
    // A legacy skillset has a config file but predates nori.json. Listing is
    // a read: it must surface the skillset without mutating it.
    const skillsetsDir = path.join(testHomeDir, ".nori", "profiles");
    const legacyDir = path.join(skillsetsDir, "legacy-profile");
    await fs.mkdir(legacyDir, { recursive: true });
    await fs.writeFile(path.join(legacyDir, "AGENTS.md"), "# instructions");

    const profiles = await listSkillsets();

    expect(profiles).toContain("legacy-profile");
    await expect(
      fs.access(path.join(legacyDir, "nori.json")),
    ).rejects.toThrow();
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

  test("lists flat profile with AGENTS.md but no nori.json without writing one", async () => {
    const skillsetsDir = path.join(testHomeDir, ".nori", "profiles");

    // Create a user-made profile with AGENTS.md but no nori.json
    const skillsetDir = path.join(skillsetsDir, "my-custom-profile");
    await fs.mkdir(skillsetDir, { recursive: true });
    await fs.writeFile(path.join(skillsetDir, "AGENTS.md"), "# My Profile");

    const profiles = await listSkillsets();

    expect(profiles).toContain("my-custom-profile");

    // Listing is a read: nori.json must not be created as a side effect
    await expect(
      fs.access(path.join(skillsetDir, "nori.json")),
    ).rejects.toThrow();
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

  test("lists flat profile with skills and subagents dirs but no nori.json without writing one", async () => {
    const skillsetsDir = path.join(testHomeDir, ".nori", "profiles");

    // Create a profile with skills/ and subagents/ but no nori.json
    const skillsetDir = path.join(skillsetsDir, "dev-profile");
    await fs.mkdir(path.join(skillsetDir, "skills"), { recursive: true });
    await fs.mkdir(path.join(skillsetDir, "subagents"), { recursive: true });

    const profiles = await listSkillsets();

    expect(profiles).toContain("dev-profile");

    // Listing is a read: nori.json must not be created as a side effect
    await expect(
      fs.access(path.join(skillsetDir, "nori.json")),
    ).rejects.toThrow();
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

  test("discovers nested legacy profiles without writing nori.json anywhere", async () => {
    const skillsetsDir = path.join(testHomeDir, ".nori", "profiles");

    // Create org directory without nori.json, with a nested profile that has AGENTS.md
    const orgDir = path.join(skillsetsDir, "myorg");
    const nestedProfile = path.join(orgDir, "team-profile");
    await fs.mkdir(nestedProfile, { recursive: true });
    await fs.writeFile(path.join(nestedProfile, "AGENTS.md"), "# Team Profile");

    const profiles = await listSkillsets();

    // Nested legacy profile should be discovered without any write
    expect(profiles).toContain("myorg/team-profile");
    // Org directory should NOT become a flat profile
    expect(profiles).not.toContain("myorg");
    // Neither the org dir nor the nested profile gets a nori.json written
    await expect(fs.access(path.join(orgDir, "nori.json"))).rejects.toThrow();
    await expect(
      fs.access(path.join(nestedProfile, "nori.json")),
    ).rejects.toThrow();
  });

  test("discovers symlinked skillset directories", async () => {
    const skillsetsDir = path.join(testHomeDir, ".nori", "profiles");
    await fs.mkdir(skillsetsDir, { recursive: true });

    // Create a real skillset directory somewhere else
    const externalDir = path.join(testHomeDir, "external-repo");
    await fs.mkdir(externalDir, { recursive: true });
    await fs.writeFile(
      path.join(externalDir, "nori.json"),
      JSON.stringify({ name: "symlinked-skillset", version: "1.0.0" }),
    );

    // Symlink profiles/symlinked-skillset -> external-repo
    await fs.symlink(
      externalDir,
      path.join(skillsetsDir, "symlinked-skillset"),
    );

    const profiles = await listSkillsets();

    expect(profiles).toContain("symlinked-skillset");
  });

  test("discovers symlinked org-scoped skillset directories", async () => {
    const skillsetsDir = path.join(testHomeDir, ".nori", "profiles");
    await fs.mkdir(skillsetsDir, { recursive: true });

    // Create org directory
    const orgDir = path.join(skillsetsDir, "myorg");
    await fs.mkdir(orgDir, { recursive: true });

    // Create external repo for the skillset
    const externalDir = path.join(testHomeDir, "external-org-repo");
    await fs.mkdir(externalDir, { recursive: true });
    await fs.writeFile(
      path.join(externalDir, "nori.json"),
      JSON.stringify({ name: "myorg/linked-profile", version: "1.0.0" }),
    );

    // Symlink profiles/myorg/linked-profile -> external-org-repo
    await fs.symlink(externalDir, path.join(orgDir, "linked-profile"));

    const profiles = await listSkillsets();

    expect(profiles).toContain("myorg/linked-profile");
  });

  test("lists personal and public bucket profiles under their bare names", async () => {
    const skillsetsDir = path.join(testHomeDir, ".nori", "profiles");

    const personalProfile = path.join(skillsetsDir, "personal", "my-local");
    const publicProfile = path.join(skillsetsDir, "public", "senior-swe");
    const orgProfile = path.join(skillsetsDir, "acme", "sessions");
    for (const [dir, name] of [
      [personalProfile, "my-local"],
      [publicProfile, "senior-swe"],
      [orgProfile, "acme/sessions"],
    ] as const) {
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(
        path.join(dir, "nori.json"),
        JSON.stringify({ name, version: "1.0.0" }),
      );
    }

    const profiles = await listSkillsets();

    expect(profiles).toContain("my-local");
    expect(profiles).toContain("senior-swe");
    expect(profiles).toContain("acme/sessions");
    expect(profiles).not.toContain("personal/my-local");
    expect(profiles).not.toContain("public/senior-swe");
  });

  test("does not list a bare name twice when it exists in a bucket and legacy location", async () => {
    const skillsetsDir = path.join(testHomeDir, ".nori", "profiles");

    const bucketDir = path.join(skillsetsDir, "personal", "shared");
    const legacyDir = path.join(skillsetsDir, "shared");
    for (const dir of [bucketDir, legacyDir]) {
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(
        path.join(dir, "nori.json"),
        JSON.stringify({ name: "shared", version: "1.0.0" }),
      );
    }

    const profiles = await listSkillsets();

    expect(profiles.filter((name) => name === "shared").length).toBe(1);
  });
});
