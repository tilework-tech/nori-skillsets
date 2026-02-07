/**
 * Tests for managedFolder utilities
 * Tests profile discovery against real filesystem structures
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";

import { listProfiles } from "@/cli/features/managedFolder.js";

// Mock os.homedir to use a test directory so getNoriProfilesDir resolves there
vi.mock("os", async (importOriginal) => {
  const actual = await importOriginal<typeof os>();
  return {
    ...actual,
    homedir: vi.fn().mockReturnValue(actual.homedir()),
  };
});

describe("listProfiles", () => {
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
    const profiles = await listProfiles();

    expect(profiles).toEqual([]);
  });

  test("returns empty array when profiles directory is empty", async () => {
    const profilesDir = path.join(testHomeDir, ".nori", "profiles");
    await fs.mkdir(profilesDir, { recursive: true });

    const profiles = await listProfiles();

    expect(profiles).toEqual([]);
  });

  test("returns profile names for directories containing CLAUDE.md", async () => {
    const profilesDir = path.join(testHomeDir, ".nori", "profiles");

    // Create valid profiles (with CLAUDE.md)
    for (const name of ["amol", "senior-swe"]) {
      const dir = path.join(profilesDir, name);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, "CLAUDE.md"), `# ${name}`);
    }

    // Create invalid profile (no CLAUDE.md)
    const invalidDir = path.join(profilesDir, "invalid-profile");
    await fs.mkdir(invalidDir, { recursive: true });
    await fs.writeFile(path.join(invalidDir, "readme.txt"), "not a profile");

    const profiles = await listProfiles();

    expect(profiles).toContain("amol");
    expect(profiles).toContain("senior-swe");
    expect(profiles).not.toContain("invalid-profile");
    expect(profiles.length).toBe(2);
  });

  test("returns namespaced profiles in nested directories", async () => {
    const profilesDir = path.join(testHomeDir, ".nori", "profiles");

    // Create flat profile (e.g., profiles/amol)
    const flatDir = path.join(profilesDir, "amol");
    await fs.mkdir(flatDir, { recursive: true });
    await fs.writeFile(path.join(flatDir, "CLAUDE.md"), "# amol");

    // Create org directory with nested profiles (e.g., profiles/myorg/my-profile)
    const orgDir = path.join(profilesDir, "myorg");
    const nestedProfile1 = path.join(orgDir, "my-profile");
    const nestedProfile2 = path.join(orgDir, "other-profile");
    await fs.mkdir(nestedProfile1, { recursive: true });
    await fs.mkdir(nestedProfile2, { recursive: true });
    await fs.writeFile(
      path.join(nestedProfile1, "CLAUDE.md"),
      "# myorg/my-profile",
    );
    await fs.writeFile(
      path.join(nestedProfile2, "CLAUDE.md"),
      "# myorg/other-profile",
    );

    const profiles = await listProfiles();

    expect(profiles).toContain("amol");
    expect(profiles).toContain("myorg/my-profile");
    expect(profiles).toContain("myorg/other-profile");
    expect(profiles.length).toBe(3);
  });

  test("org directory without CLAUDE.md is treated as org, not profile", async () => {
    const profilesDir = path.join(testHomeDir, ".nori", "profiles");

    // Create org directory without CLAUDE.md but with nested profile
    const orgDir = path.join(profilesDir, "myorg");
    const nestedProfile = path.join(orgDir, "my-profile");
    await fs.mkdir(nestedProfile, { recursive: true });
    await fs.writeFile(
      path.join(nestedProfile, "CLAUDE.md"),
      "# myorg/my-profile",
    );

    // Also create readme.txt in org dir to simulate a non-profile directory
    await fs.writeFile(path.join(orgDir, "readme.txt"), "org readme");

    const profiles = await listProfiles();

    // Should only include the nested profile, not the org directory itself
    expect(profiles).toContain("myorg/my-profile");
    expect(profiles).not.toContain("myorg");
    expect(profiles.length).toBe(1);
  });
});
