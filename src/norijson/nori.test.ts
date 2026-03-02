/**
 * Tests for nori.json metadata utilities (read/write/ensure)
 */

import * as fs from "fs/promises";
import { tmpdir } from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  readSkillsetMetadata,
  writeSkillsetMetadata,
  addSkillToNoriJson,
  ensureNoriJson,
} from "@/norijson/nori.js";

describe("writeSkillsetMetadata", () => {
  let skillsetDir: string;

  beforeEach(async () => {
    skillsetDir = await fs.mkdtemp(path.join(tmpdir(), "nori-metadata-test-"));
  });

  afterEach(async () => {
    await fs.rm(skillsetDir, { recursive: true, force: true });
  });

  it("should write nori.json that can be read back by readSkillsetMetadata", async () => {
    const metadata = {
      name: "test-profile",
      version: "1.0.0",
      description: "A test profile",
    };

    await writeSkillsetMetadata({ skillsetDir, metadata });

    const result = await readSkillsetMetadata({ skillsetDir });
    expect(result).toEqual(metadata);
  });

  it("should preserve all fields including dependencies", async () => {
    const metadata = {
      name: "test-profile",
      version: "2.0.0",
      description: "Profile with dependencies",
      dependencies: {
        skills: {
          "writing-plans": "^1.0.0",
          "systematic-debugging": "*",
        },
      },
    };

    await writeSkillsetMetadata({ skillsetDir, metadata });

    const result = await readSkillsetMetadata({ skillsetDir });
    expect(result).toEqual(metadata);
  });

  it("should overwrite existing nori.json", async () => {
    const original = { name: "original", version: "1.0.0" };
    const updated = { name: "updated", version: "2.0.0" };

    await writeSkillsetMetadata({ skillsetDir, metadata: original });
    await writeSkillsetMetadata({ skillsetDir, metadata: updated });

    const result = await readSkillsetMetadata({ skillsetDir });
    expect(result).toEqual(updated);
  });

  it("should preserve the type field through write/read cycle", async () => {
    const metadata = {
      name: "test-profile",
      version: "1.0.0",
      type: "skillset" as const,
    };

    await writeSkillsetMetadata({ skillsetDir, metadata });

    const result = await readSkillsetMetadata({ skillsetDir });
    expect(result.type).toBe("skillset");
  });
});

describe("addSkillToNoriJson", () => {
  let skillsetDir: string;

  beforeEach(async () => {
    skillsetDir = await fs.mkdtemp(path.join(tmpdir(), "nori-metadata-test-"));
  });

  afterEach(async () => {
    await fs.rm(skillsetDir, { recursive: true, force: true });
  });

  it("should create nori.json when none exists and add the skill", async () => {
    await addSkillToNoriJson({
      skillsetDir,
      skillName: "my-skill",
      version: "*",
    });

    const metadata = await readSkillsetMetadata({ skillsetDir });
    expect(metadata.name).toBe(path.basename(skillsetDir));
    expect(metadata.version).toBe("1.0.0");
    expect(metadata.dependencies?.skills).toEqual({ "my-skill": "*" });
  });

  it("should set type to skillset when creating a new nori.json", async () => {
    await addSkillToNoriJson({
      skillsetDir,
      skillName: "my-skill",
      version: "*",
    });

    const metadata = await readSkillsetMetadata({ skillsetDir });
    expect(metadata.type).toBe("skillset");
  });

  it("should preserve existing type field when adding a skill", async () => {
    await writeSkillsetMetadata({
      skillsetDir,
      metadata: { name: "my-profile", version: "1.0.0", type: "skill" },
    });

    await addSkillToNoriJson({
      skillsetDir,
      skillName: "new-skill",
      version: "^2.0.0",
    });

    const metadata = await readSkillsetMetadata({ skillsetDir });
    expect(metadata.type).toBe("skill");
  });

  it("should add skill to existing nori.json that has no dependencies key", async () => {
    await writeSkillsetMetadata({
      skillsetDir,
      metadata: { name: "my-profile", version: "1.0.0" },
    });

    await addSkillToNoriJson({
      skillsetDir,
      skillName: "new-skill",
      version: "^2.0.0",
    });

    const metadata = await readSkillsetMetadata({ skillsetDir });
    expect(metadata.name).toBe("my-profile");
    expect(metadata.version).toBe("1.0.0");
    expect(metadata.dependencies?.skills).toEqual({ "new-skill": "^2.0.0" });
  });

  it("should add skill to existing nori.json preserving existing skill dependencies", async () => {
    await writeSkillsetMetadata({
      skillsetDir,
      metadata: {
        name: "my-profile",
        version: "1.0.0",
        dependencies: {
          skills: {
            "existing-skill": "^1.0.0",
            "another-skill": "*",
          },
        },
      },
    });

    await addSkillToNoriJson({
      skillsetDir,
      skillName: "new-skill",
      version: "*",
    });

    const metadata = await readSkillsetMetadata({ skillsetDir });
    expect(metadata.dependencies?.skills).toEqual({
      "existing-skill": "^1.0.0",
      "another-skill": "*",
      "new-skill": "*",
    });
  });

  it("should throw when nori.json contains corrupt JSON", async () => {
    await fs.writeFile(
      path.join(skillsetDir, "nori.json"),
      "{ this is not valid json",
    );

    await expect(
      addSkillToNoriJson({
        skillsetDir,
        skillName: "my-skill",
        version: "*",
      }),
    ).rejects.toThrow("nori.json exists but contains invalid JSON");
  });

  it("should update version for an already-present skill", async () => {
    await writeSkillsetMetadata({
      skillsetDir,
      metadata: {
        name: "my-profile",
        version: "1.0.0",
        dependencies: {
          skills: {
            "my-skill": "^1.0.0",
          },
        },
      },
    });

    await addSkillToNoriJson({
      skillsetDir,
      skillName: "my-skill",
      version: "*",
    });

    const metadata = await readSkillsetMetadata({ skillsetDir });
    expect(metadata.dependencies?.skills).toEqual({ "my-skill": "*" });
  });
});

describe("ensureNoriJson", () => {
  let skillsetDir: string;

  beforeEach(async () => {
    skillsetDir = await fs.mkdtemp(path.join(tmpdir(), "nori-metadata-test-"));
  });

  afterEach(async () => {
    await fs.rm(skillsetDir, { recursive: true, force: true });
  });

  it("should create nori.json when directory has CLAUDE.md but no nori.json", async () => {
    await fs.writeFile(path.join(skillsetDir, "CLAUDE.md"), "# My Profile");

    await ensureNoriJson({ skillsetDir });

    const metadata = await readSkillsetMetadata({ skillsetDir });
    expect(metadata.name).toBe(path.basename(skillsetDir));
    expect(metadata.version).toBe("0.0.1");
  });

  it("should set type to skillset on auto-created nori.json", async () => {
    await fs.writeFile(path.join(skillsetDir, "CLAUDE.md"), "# My Profile");

    await ensureNoriJson({ skillsetDir });

    const metadata = await readSkillsetMetadata({ skillsetDir });
    expect(metadata.type).toBe("skillset");
  });

  it("should not overwrite existing type field", async () => {
    const existing = {
      name: "my-profile",
      version: "2.0.0",
      type: "skill" as const,
    };
    await writeSkillsetMetadata({ skillsetDir, metadata: existing });
    await fs.writeFile(path.join(skillsetDir, "CLAUDE.md"), "# My Profile");

    await ensureNoriJson({ skillsetDir });

    const metadata = await readSkillsetMetadata({ skillsetDir });
    expect(metadata.type).toBe("skill");
  });

  it("should create nori.json when directory has skills and subagents dirs but no nori.json", async () => {
    await fs.mkdir(path.join(skillsetDir, "skills"));
    await fs.mkdir(path.join(skillsetDir, "subagents"));

    await ensureNoriJson({ skillsetDir });

    const metadata = await readSkillsetMetadata({ skillsetDir });
    expect(metadata.name).toBe(path.basename(skillsetDir));
    expect(metadata.version).toBe("0.0.1");
  });

  it("should not create nori.json when directory has no profile markers", async () => {
    await fs.writeFile(path.join(skillsetDir, "readme.txt"), "not a profile");

    await ensureNoriJson({ skillsetDir });

    const noriJsonPath = path.join(skillsetDir, "nori.json");
    await expect(fs.access(noriJsonPath)).rejects.toThrow();
  });

  it("should not create nori.json when only skills dir exists without subagents", async () => {
    await fs.mkdir(path.join(skillsetDir, "skills"));

    await ensureNoriJson({ skillsetDir });

    const noriJsonPath = path.join(skillsetDir, "nori.json");
    await expect(fs.access(noriJsonPath)).rejects.toThrow();
  });

  it("should not overwrite existing nori.json", async () => {
    const existing = { name: "my-profile", version: "2.0.0" };
    await writeSkillsetMetadata({ skillsetDir, metadata: existing });
    await fs.writeFile(path.join(skillsetDir, "CLAUDE.md"), "# My Profile");

    await ensureNoriJson({ skillsetDir });

    const metadata = await readSkillsetMetadata({ skillsetDir });
    expect(metadata.name).toBe("my-profile");
    expect(metadata.version).toBe("2.0.0");
  });

  it("should do nothing when directory does not exist", async () => {
    const nonExistentDir = path.join(skillsetDir, "does-not-exist");

    await ensureNoriJson({ skillsetDir: nonExistentDir });

    const noriJsonPath = path.join(nonExistentDir, "nori.json");
    await expect(fs.access(noriJsonPath)).rejects.toThrow();
  });

  it("should create nori.json when directory has custom config file name", async () => {
    await fs.writeFile(path.join(skillsetDir, "RULES.md"), "# Rules");

    await ensureNoriJson({ skillsetDir, configFileNames: ["RULES.md"] });

    const metadata = await readSkillsetMetadata({ skillsetDir });
    expect(metadata.name).toBe(path.basename(skillsetDir));
    expect(metadata.version).toBe("0.0.1");
  });

  it("should not detect CLAUDE.md when custom config file names exclude it", async () => {
    await fs.writeFile(path.join(skillsetDir, "CLAUDE.md"), "# My Profile");

    await ensureNoriJson({ skillsetDir, configFileNames: ["RULES.md"] });

    const noriJsonPath = path.join(skillsetDir, "nori.json");
    await expect(fs.access(noriJsonPath)).rejects.toThrow();
  });
});
