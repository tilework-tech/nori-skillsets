/**
 * Tests for the one-time profiles bucket migration.
 *
 * Behavior under test: existing bare profiles in ~/.nori/profiles/<name> are
 * relocated into ~/.nori/profiles/personal/<name> (locally created) or
 * ~/.nori/profiles/public/<name> (associated with the public registrar), once,
 * idempotently, without clobbering existing data or touching org profiles.
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock os.homedir so getNoriSkillsetsDir() resolves to the test directory.
vi.mock("os", async (importOriginal) => {
  const actual = await importOriginal<typeof os>();
  return {
    ...actual,
    homedir: vi.fn().mockReturnValue(actual.homedir()),
  };
});

import { runProfilesMigration } from "@/cli/profilesMigration.js";

const PUBLIC_REGISTRY_URL = "https://noriskillsets.dev";

const dirExists = async (dir: string): Promise<boolean> => {
  try {
    const stat = await fs.stat(dir);
    return stat.isDirectory();
  } catch {
    return false;
  }
};

describe("runProfilesMigration", () => {
  let testHomeDir: string;
  let profilesDir: string;

  const seedProfile = async (args: {
    name: string;
    registryUrl?: string | null;
  }): Promise<string> => {
    const { name, registryUrl } = args;
    const dir = path.join(profilesDir, name);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, "nori.json"),
      JSON.stringify({ name, version: "1.0.0", type: "skillset" }),
    );
    if (registryUrl != null) {
      await fs.writeFile(
        path.join(dir, ".nori-version"),
        JSON.stringify({ version: "1.0.0", registryUrl }),
      );
    }
    return dir;
  };

  beforeEach(async () => {
    testHomeDir = await fs.mkdtemp(path.join(os.tmpdir(), "profiles-mig-"));
    vi.mocked(os.homedir).mockReturnValue(testHomeDir);
    profilesDir = path.join(testHomeDir, ".nori", "profiles");
    await fs.mkdir(profilesDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testHomeDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("moves a locally created bare profile (no .nori-version) into personal/", async () => {
    await seedProfile({ name: "my-local" });

    await runProfilesMigration();

    expect(
      await dirExists(path.join(profilesDir, "personal", "my-local")),
    ).toBe(true);
    expect(await dirExists(path.join(profilesDir, "my-local"))).toBe(false);
  });

  it("moves a public-registrar profile into public/", async () => {
    await seedProfile({
      name: "senior-swe",
      registryUrl: PUBLIC_REGISTRY_URL,
    });

    await runProfilesMigration();

    expect(
      await dirExists(path.join(profilesDir, "public", "senior-swe")),
    ).toBe(true);
    expect(await dirExists(path.join(profilesDir, "senior-swe"))).toBe(false);
  });

  it("treats a bare profile stamped with an org registry URL as personal", async () => {
    await seedProfile({
      name: "weird",
      registryUrl: "https://acme.noriskillsets.dev",
    });

    await runProfilesMigration();

    expect(await dirExists(path.join(profilesDir, "personal", "weird"))).toBe(
      true,
    );
    expect(await dirExists(path.join(profilesDir, "public", "weird"))).toBe(
      false,
    );
  });

  it("leaves org-namespaced profiles untouched", async () => {
    const orgProfile = path.join(profilesDir, "acme", "sessions");
    await fs.mkdir(orgProfile, { recursive: true });
    await fs.writeFile(
      path.join(orgProfile, "nori.json"),
      JSON.stringify({ name: "acme/sessions", version: "1.0.0" }),
    );

    await runProfilesMigration();

    expect(await dirExists(orgProfile)).toBe(true);
    expect(await dirExists(path.join(profilesDir, "personal", "acme"))).toBe(
      false,
    );
    expect(await dirExists(path.join(profilesDir, "public", "acme"))).toBe(
      false,
    );
  });

  it("is idempotent: running twice produces the same layout with no further moves", async () => {
    await seedProfile({ name: "my-local" });
    await seedProfile({ name: "downloaded", registryUrl: PUBLIC_REGISTRY_URL });

    const first = await runProfilesMigration();
    const second = await runProfilesMigration();

    expect(first.moved).toBe(2);
    expect(second.moved).toBe(0);
    expect(
      await dirExists(path.join(profilesDir, "personal", "my-local")),
    ).toBe(true);
    expect(
      await dirExists(path.join(profilesDir, "public", "downloaded")),
    ).toBe(true);
  });

  it("resumes a partially completed migration without clobbering already-moved profiles", async () => {
    // "already-moved" is in its bucket; "still-bare" has not been moved yet.
    // No marker present, so the migration runs and finishes the remaining move.
    const alreadyMoved = path.join(profilesDir, "personal", "already-moved");
    await fs.mkdir(alreadyMoved, { recursive: true });
    await fs.writeFile(
      path.join(alreadyMoved, "nori.json"),
      JSON.stringify({ name: "already-moved", version: "1.0.0" }),
    );
    await fs.writeFile(
      path.join(alreadyMoved, "sentinel.txt"),
      "do-not-clobber",
    );
    await seedProfile({ name: "still-bare" });

    await runProfilesMigration();

    expect(
      await dirExists(path.join(profilesDir, "personal", "still-bare")),
    ).toBe(true);
    // The pre-existing bucket profile is untouched.
    expect(
      await fs.readFile(path.join(alreadyMoved, "sentinel.txt"), "utf-8"),
    ).toBe("do-not-clobber");
  });

  it("does not overwrite an existing destination on collision", async () => {
    // A bare profile and a same-named bucket profile both exist.
    await seedProfile({ name: "clash" });
    const bucketDir = path.join(profilesDir, "personal", "clash");
    await fs.mkdir(bucketDir, { recursive: true });
    await fs.writeFile(
      path.join(bucketDir, "nori.json"),
      JSON.stringify({ name: "clash", version: "9.9.9" }),
    );
    await fs.writeFile(path.join(bucketDir, "keep.txt"), "keep-me");

    await runProfilesMigration();

    // The existing bucket profile is preserved, not overwritten.
    expect(await fs.readFile(path.join(bucketDir, "keep.txt"), "utf-8")).toBe(
      "keep-me",
    );
    // The bare profile is left in place rather than clobbering the destination.
    expect(await dirExists(path.join(profilesDir, "clash"))).toBe(true);
  });

  it("relocates a symlinked bare profile into a bucket as a symlink", async () => {
    const externalDir = path.join(testHomeDir, "external-repo");
    await fs.mkdir(externalDir, { recursive: true });
    await fs.writeFile(
      path.join(externalDir, "nori.json"),
      JSON.stringify({ name: "linked", version: "1.0.0" }),
    );
    await fs.symlink(externalDir, path.join(profilesDir, "linked"));

    await runProfilesMigration();

    // The link is relocated (no .nori-version => personal) and still points at
    // the same target.
    const movedLink = path.join(profilesDir, "personal", "linked");
    const linkStat = await fs.lstat(movedLink);
    expect(linkStat.isSymbolicLink()).toBe(true);
    expect(await fs.readlink(movedLink)).toBe(externalDir);
    // The original flat location is gone.
    await expect(fs.lstat(path.join(profilesDir, "linked"))).rejects.toThrow();
  });

  it("does not move a pre-existing skillset whose name collides with a bucket", async () => {
    // A real skillset literally named "public" cannot live in the new layout.
    await seedProfile({ name: "public" });

    await runProfilesMigration();

    // It is left where it is (not moved into public/public) and no data is lost.
    expect(await dirExists(path.join(profilesDir, "public", "public"))).toBe(
      false,
    );
    expect(
      await fs.readFile(path.join(profilesDir, "public", "nori.json"), "utf-8"),
    ).toContain("public");
  });

  it("does not error when the profiles directory is absent", async () => {
    await fs.rm(profilesDir, { recursive: true, force: true });

    const result = await runProfilesMigration();

    expect(result.moved).toBe(0);
  });

  it("rewrites a stored bare activeSkillset to its public/ identity", async () => {
    await seedProfile({ name: "senior-swe", registryUrl: PUBLIC_REGISTRY_URL });
    const configPath = path.join(testHomeDir, ".nori-config.json");
    await fs.writeFile(
      configPath,
      JSON.stringify({ activeSkillset: "senior-swe" }),
    );

    await runProfilesMigration();

    const config = JSON.parse(await fs.readFile(configPath, "utf-8"));
    expect(config.activeSkillset).toBe("public/senior-swe");
  });

  it("rewrites a stored bare local activeSkillset to its personal/ identity", async () => {
    await seedProfile({ name: "my-local" });
    const configPath = path.join(testHomeDir, ".nori-config.json");
    await fs.writeFile(
      configPath,
      JSON.stringify({ activeSkillset: "my-local" }),
    );

    await runProfilesMigration();

    const config = JSON.parse(await fs.readFile(configPath, "utf-8"));
    expect(config.activeSkillset).toBe("personal/my-local");
  });

  it("leaves a stored activeSkillset that resolves nowhere untouched", async () => {
    const configPath = path.join(testHomeDir, ".nori-config.json");
    await fs.writeFile(
      configPath,
      JSON.stringify({ activeSkillset: "not-installed" }),
    );

    await runProfilesMigration();

    const config = JSON.parse(await fs.readFile(configPath, "utf-8"));
    expect(config.activeSkillset).toBe("not-installed");
  });
});
