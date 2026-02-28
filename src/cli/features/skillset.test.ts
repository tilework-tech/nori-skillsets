/**
 * Tests for Skillset type parsing
 * Verifies that parseSkillset correctly reads a skillset directory structure
 */

import * as fs from "fs/promises";
import { tmpdir } from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let mockNoriDir: string;

vi.mock("@/cli/features/paths.js", () => ({
  getNoriDir: () => mockNoriDir,
  getNoriSkillsetsDir: () => path.join(mockNoriDir, "profiles"),
}));

import { parseSkillset } from "@/cli/features/skillset.js";

describe("parseSkillset", () => {
  let tempDir: string;
  let profilesDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(tmpdir(), "skillset-parse-test-"));
    mockNoriDir = path.join(tempDir, ".nori");
    profilesDir = path.join(mockNoriDir, "profiles");
    await fs.mkdir(profilesDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("should parse a fully-populated skillset directory", async () => {
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
    await fs.writeFile(path.join(skillsetDir, "CLAUDE.md"), "# My Profile\n");
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
    expect(skillset.configFilePath).toBe(path.join(skillsetDir, "CLAUDE.md"));
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
    await fs.writeFile(path.join(skillsetDir, "CLAUDE.md"), "# Org Profile\n");

    const skillset = await parseSkillset({ skillsetName });

    expect(skillset.name).toBe("myorg/my-skillset");
    expect(skillset.dir).toBe(skillsetDir);
    expect(skillset.configFilePath).toBe(path.join(skillsetDir, "CLAUDE.md"));
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

  it("should parse legacy skillsets that have CLAUDE.md but no nori.json", async () => {
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
