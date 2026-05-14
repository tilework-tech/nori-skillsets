/**
 * Tests for listSkillsetsWithMetadata — separated to avoid breaking
 * existing skillset.test.ts if the export doesn't exist yet
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";

// Mock os.homedir so getNoriSkillsetsDir() resolves to test directories
vi.mock("os", async (importOriginal) => {
  const actual = await importOriginal<typeof os>();
  return {
    ...actual,
    homedir: vi.fn().mockReturnValue(actual.homedir()),
  };
});

import { listSkillsetsWithMetadata } from "@/norijson/skillset.js";

describe("listSkillsetsWithMetadata", () => {
  let testHomeDir: string;

  beforeEach(async () => {
    testHomeDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "skillset-metadata-test-"),
    );
    vi.mocked(os.homedir).mockReturnValue(testHomeDir);
  });

  afterEach(async () => {
    if (testHomeDir) {
      await fs.rm(testHomeDir, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  test("marks regular skillsets as not linked", async () => {
    const skillsetsDir = path.join(testHomeDir, ".nori", "profiles");
    const regularDir = path.join(skillsetsDir, "regular");
    await fs.mkdir(regularDir, { recursive: true });
    await fs.writeFile(
      path.join(regularDir, "nori.json"),
      JSON.stringify({ name: "regular", version: "1.0.0" }),
    );

    const entries = await listSkillsetsWithMetadata();

    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe("regular");
    expect(entries[0].isLinked).toBe(false);
  });

  test("marks symlinked skillsets as linked", async () => {
    const skillsetsDir = path.join(testHomeDir, ".nori", "profiles");
    await fs.mkdir(skillsetsDir, { recursive: true });

    const externalDir = path.join(testHomeDir, "external-repo");
    await fs.mkdir(externalDir, { recursive: true });
    await fs.writeFile(
      path.join(externalDir, "nori.json"),
      JSON.stringify({ name: "linked", version: "1.0.0" }),
    );
    await fs.symlink(externalDir, path.join(skillsetsDir, "linked"));

    const entries = await listSkillsetsWithMetadata();

    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe("linked");
    expect(entries[0].isLinked).toBe(true);
  });

  test("returns both linked and unlinked skillsets together", async () => {
    const skillsetsDir = path.join(testHomeDir, ".nori", "profiles");
    await fs.mkdir(skillsetsDir, { recursive: true });

    // Regular skillset
    const regularDir = path.join(skillsetsDir, "regular");
    await fs.mkdir(regularDir, { recursive: true });
    await fs.writeFile(
      path.join(regularDir, "nori.json"),
      JSON.stringify({ name: "regular", version: "1.0.0" }),
    );

    // Symlinked skillset
    const externalDir = path.join(testHomeDir, "external-repo");
    await fs.mkdir(externalDir, { recursive: true });
    await fs.writeFile(
      path.join(externalDir, "nori.json"),
      JSON.stringify({ name: "linked", version: "1.0.0" }),
    );
    await fs.symlink(externalDir, path.join(skillsetsDir, "linked"));

    const entries = await listSkillsetsWithMetadata();

    const regularEntry = entries.find((e) => e.name === "regular")!;
    const linkedEntry = entries.find((e) => e.name === "linked")!;

    expect(regularEntry.isLinked).toBe(false);
    expect(linkedEntry.isLinked).toBe(true);
  });
});
