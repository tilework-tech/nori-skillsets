/**
 * Tests for the user-facing skillset resolution edge: resolveUserSkillsetRef
 * and namespaceCreateSkillsetName.
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock os.homedir so getNoriSkillsetsDir() resolves to test directories
vi.mock("os", async (importOriginal) => {
  const actual = await importOriginal<typeof os>();
  return {
    ...actual,
    homedir: vi.fn().mockReturnValue(actual.homedir()),
  };
});

import {
  resolveUserSkillsetRef,
  namespaceCreateSkillsetName,
} from "@/cli/skillsetResolution.js";

describe("namespaceCreateSkillsetName", () => {
  it("prefixes a bare name with the default org", () => {
    expect(
      namespaceCreateSkillsetName({ name: "amol", defaultOrg: "myorg" }),
    ).toBe("myorg/amol");
  });

  it("returns a bare name unchanged when there is no default org", () => {
    expect(namespaceCreateSkillsetName({ name: "amol" })).toBe("amol");
    expect(namespaceCreateSkillsetName({ name: "amol", defaultOrg: "" })).toBe(
      "amol",
    );
  });

  it("leaves an already-namespaced name unchanged", () => {
    expect(
      namespaceCreateSkillsetName({
        name: "otherorg/amol",
        defaultOrg: "myorg",
      }),
    ).toBe("otherorg/amol");
  });

  it("leaves an explicit bucket name unchanged", () => {
    expect(
      namespaceCreateSkillsetName({ name: "public/amol", defaultOrg: "myorg" }),
    ).toBe("public/amol");
    expect(
      namespaceCreateSkillsetName({
        name: "personal/amol",
        defaultOrg: "myorg",
      }),
    ).toBe("personal/amol");
  });
});

describe("resolveUserSkillsetRef", () => {
  let testHomeDir: string;
  let profilesDir: string;
  let stderrOutput: Array<string>;

  const seedBucket = async (bucket: string, name: string): Promise<void> => {
    const dir = path.join(profilesDir, bucket, name);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, "nori.json"),
      JSON.stringify({ name, version: "1.0.0" }),
    );
  };

  beforeEach(async () => {
    testHomeDir = await fs.mkdtemp(path.join(os.tmpdir(), "resolve-warn-"));
    vi.mocked(os.homedir).mockReturnValue(testHomeDir);
    profilesDir = path.join(testHomeDir, ".nori", "profiles");
    await fs.mkdir(profilesDir, { recursive: true });
    stderrOutput = [];
    vi.spyOn(process.stderr, "write").mockImplementation(((
      chunk: string | Uint8Array,
    ): boolean => {
      stderrOutput.push(String(chunk));
      return true;
    }) as typeof process.stderr.write);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(testHomeDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("returns the resolved dir and namespaced identity for a bare bucketed name", async () => {
    await seedBucket("public", "senior-swe");

    const resolved = await resolveUserSkillsetRef({ name: "senior-swe" });

    expect(resolved?.dir).toBe(path.join(profilesDir, "public", "senior-swe"));
    expect(resolved?.identity).toBe("public/senior-swe");
  });

  it("warns that a bare name is deprecated when it resolves to a bucket", async () => {
    await seedBucket("public", "warn-alpha");

    await resolveUserSkillsetRef({ name: "warn-alpha" });

    const output = stderrOutput.join("");
    expect(output).toContain("public/warn-alpha");
    expect(output.toLowerCase()).toContain("deprecated");
  });

  it("prefers defaultOrg over bucketed local skillsets for bare names", async () => {
    await seedBucket("dev", "high-autonomy");
    await seedBucket("personal", "high-autonomy");
    await seedBucket("public", "high-autonomy");

    const resolved = await resolveUserSkillsetRef({
      name: "high-autonomy",
      defaultOrg: "dev",
    });

    expect(resolved?.identity).toBe("dev/high-autonomy");
  });

  it("does not apply defaultOrg to active-skillset fallbacks", async () => {
    await seedBucket("dev", "high-autonomy");
    await seedBucket("personal", "high-autonomy");

    const resolved = await resolveUserSkillsetRef({
      name: null,
      activeSkillset: "high-autonomy",
      defaultOrg: "dev",
    });

    expect(resolved?.identity).toBe("personal/high-autonomy");
  });

  it("keeps explicit public names scoped to public when defaultOrg is configured", async () => {
    await seedBucket("dev", "high-autonomy");
    await seedBucket("public", "high-autonomy");

    const resolved = await resolveUserSkillsetRef({
      name: "public/high-autonomy",
      defaultOrg: "dev",
    });

    expect(resolved?.identity).toBe("public/high-autonomy");
  });

  it("does not fall back to a bucketed local skillset when the defaultOrg target is absent", async () => {
    await seedBucket("personal", "high-autonomy");

    const resolved = await resolveUserSkillsetRef({
      name: "high-autonomy",
      defaultOrg: "dev",
    });

    // Strict: a bare name with a default org resolves to <defaultOrg>/name only,
    // never a same-named public/personal skillset.
    expect(resolved).toBeNull();
  });

  it("does not warn when the namespaced identity is used", async () => {
    await seedBucket("public", "warn-beta");

    await resolveUserSkillsetRef({ name: "public/warn-beta" });

    expect(stderrOutput).toHaveLength(0);
  });

  it("does not warn when the warning is suppressed", async () => {
    await seedBucket("public", "warn-gamma");

    await resolveUserSkillsetRef({ name: "warn-gamma", warn: false });

    expect(stderrOutput).toHaveLength(0);
  });
});
