/**
 * Tests for the switch redownload policy: switching to a skillset only triggers
 * a registry re-download when that skillset actually came from a registry.
 * Locally-created (personal-bucket) skillsets are never re-downloaded.
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock os.homedir so getNoriSkillsetsDir() resolves to the test directory.
vi.mock("os", async (importOriginal) => {
  const actual = await importOriginal<typeof os>();
  return {
    ...actual,
    homedir: vi.fn().mockReturnValue(actual.homedir()),
  };
});

import { isRedownloadableSkillset } from "./switchSkillset.js";

describe("isRedownloadableSkillset", () => {
  let testHomeDir: string;
  let profilesDir: string;

  const seed = async (args: {
    relParts: Array<string>;
    registryUrl?: string | null;
  }): Promise<void> => {
    const { relParts, registryUrl } = args;
    const dir = path.join(profilesDir, ...relParts);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, "nori.json"),
      JSON.stringify({
        name: relParts[relParts.length - 1],
        version: "1.0.0",
      }),
    );
    if (registryUrl != null) {
      await fs.writeFile(
        path.join(dir, ".nori-version"),
        JSON.stringify({ version: "1.0.0", registryUrl }),
      );
    }
  };

  beforeEach(async () => {
    testHomeDir = await fs.mkdtemp(path.join(os.tmpdir(), "redownload-pol-"));
    vi.mocked(os.homedir).mockReturnValue(testHomeDir);
    profilesDir = path.join(testHomeDir, ".nori", "profiles");
    await fs.mkdir(profilesDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testHomeDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("is true for a public-bucket skillset switched by its bare name", async () => {
    await seed({
      relParts: ["public", "senior-swe"],
      registryUrl: "https://noriskillsets.dev",
    });

    expect(await isRedownloadableSkillset({ name: "senior-swe" })).toBe(true);
  });

  it("is false for a personal-bucket skillset switched by its namespaced name", async () => {
    await seed({ relParts: ["personal", "my-local"] });

    expect(await isRedownloadableSkillset({ name: "personal/my-local" })).toBe(
      false,
    );
  });

  it("is false for a personal-bucket skillset switched by its bare name", async () => {
    await seed({ relParts: ["personal", "my-local"] });

    expect(await isRedownloadableSkillset({ name: "my-local" })).toBe(false);
  });

  it("is false for a name that resolves to no installed skillset", async () => {
    expect(await isRedownloadableSkillset({ name: "ghost" })).toBe(false);
  });
});
