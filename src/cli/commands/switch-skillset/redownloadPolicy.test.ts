/**
 * Tests for the switch redownload policy: switching to a skillset only triggers
 * a registry re-download when that skillset actually came from a registry, and
 * the refetch is pinned to the registry recorded in the skillset's
 * `.nori-version` provenance — not a registry re-derived from the name.
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

import { resolveRedownloadSource } from "./switchSkillset.js";

describe("resolveRedownloadSource", () => {
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

  it("returns the recorded registry for a public-bucket skillset switched by its bare name", async () => {
    await seed({
      relParts: ["public", "senior-swe"],
      registryUrl: "https://noriskillsets.dev",
    });

    expect(await resolveRedownloadSource({ name: "senior-swe" })).toEqual({
      packageSpec: "public/senior-swe",
      registryUrl: "https://noriskillsets.dev",
    });
  });

  it("returns the exact recorded host, not a host re-derived from the name", async () => {
    // The name "myorg/foo" would derive to myorg.noriskillsets.dev, but the
    // skillset was installed from a different registry family. The recorded
    // provenance must win.
    await seed({
      relParts: ["myorg", "foo"],
      registryUrl: "https://myorg.nori-registry.ai",
    });

    expect(await resolveRedownloadSource({ name: "myorg/foo" })).toEqual({
      packageSpec: "myorg/foo",
      registryUrl: "https://myorg.nori-registry.ai",
    });
  });

  it("pins the refetch to the canonical namespaced identity, not the bare name it was switched by", async () => {
    // A registry-backed skillset in a non-public bucket, switched to by its
    // bare name. The refetch must target its actual on-disk bucket
    // (personal/adopted), not the bucket a bare name would derive (public/).
    await seed({
      relParts: ["personal", "adopted"],
      registryUrl: "https://myorg.noriskillsets.dev",
    });

    expect(await resolveRedownloadSource({ name: "adopted" })).toEqual({
      packageSpec: "personal/adopted",
      registryUrl: "https://myorg.noriskillsets.dev",
    });
  });

  it("keys off recorded provenance, not the bucket: returns null for a public-bucket skillset with no .nori-version", async () => {
    await seed({ relParts: ["public", "hand-made"] });

    expect(await resolveRedownloadSource({ name: "hand-made" })).toBe(null);
  });

  it("returns null for a personal-bucket skillset switched by its namespaced name", async () => {
    await seed({ relParts: ["personal", "my-local"] });

    expect(await resolveRedownloadSource({ name: "personal/my-local" })).toBe(
      null,
    );
  });

  it("returns null for a personal-bucket skillset switched by its bare name", async () => {
    await seed({ relParts: ["personal", "my-local"] });

    expect(await resolveRedownloadSource({ name: "my-local" })).toBe(null);
  });

  it("returns null for a name that resolves to no installed skillset", async () => {
    expect(await resolveRedownloadSource({ name: "ghost" })).toBe(null);
  });
});
