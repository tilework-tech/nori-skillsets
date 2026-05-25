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
  addSubagentToNoriJson,
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

  it("should sort skills array alphabetically by name", async () => {
    const metadata = {
      name: "test-profile",
      version: "1.0.0",
      skills: [
        { id: "z-skill", name: "Zebra Skill", description: "Last" },
        { id: "a-skill", name: "Alpha Skill", description: "First" },
        { id: "m-skill", name: "Middle Skill", description: "Middle" },
      ],
    };

    await writeSkillsetMetadata({ skillsetDir, metadata });

    const result = await readSkillsetMetadata({ skillsetDir });
    expect(result.skills!.map((s) => s.name)).toEqual([
      "Alpha Skill",
      "Middle Skill",
      "Zebra Skill",
    ]);
  });

  it("should sort subagents array alphabetically by name", async () => {
    const metadata = {
      name: "test-profile",
      version: "1.0.0",
      subagents: [
        { id: "z-agent", name: "Zeta Agent", description: "Last" },
        { id: "a-agent", name: "Alpha Agent", description: "First" },
      ],
    };

    await writeSkillsetMetadata({ skillsetDir, metadata });

    const result = await readSkillsetMetadata({ skillsetDir });
    expect(result.subagents!.map((s) => s.name)).toEqual([
      "Alpha Agent",
      "Zeta Agent",
    ]);
  });

  it("should sort slashcommands array alphabetically by command", async () => {
    const metadata = {
      name: "test-profile",
      version: "1.0.0",
      slashcommands: [
        { command: "review", description: "Review code" },
        { command: "debug", description: "Debug code" },
        { command: "lint", description: "Lint code" },
      ],
    };

    await writeSkillsetMetadata({ skillsetDir, metadata });

    const result = await readSkillsetMetadata({ skillsetDir });
    expect(result.slashcommands!.map((s) => s.command)).toEqual([
      "debug",
      "lint",
      "review",
    ]);
  });

  it("should sort keywords array alphabetically", async () => {
    const metadata = {
      name: "test-profile",
      version: "1.0.0",
      keywords: ["testing", "automation", "debugging"],
    };

    await writeSkillsetMetadata({ skillsetDir, metadata });

    const result = await readSkillsetMetadata({ skillsetDir });
    expect(result.keywords).toEqual(["automation", "debugging", "testing"]);
  });

  it("should sort dependency object keys alphabetically", async () => {
    const metadata = {
      name: "test-profile",
      version: "1.0.0",
      dependencies: {
        skills: {
          "z-skill": "^1.0.0",
          "a-skill": "*",
          "m-skill": "^2.0.0",
        },
        subagents: {
          "z-agent": "*",
          "a-agent": "^1.0.0",
        },
      },
    };

    await writeSkillsetMetadata({ skillsetDir, metadata });

    const result = await readSkillsetMetadata({ skillsetDir });
    expect(Object.keys(result.dependencies!.skills!)).toEqual([
      "a-skill",
      "m-skill",
      "z-skill",
    ]);
    expect(Object.keys(result.dependencies!.subagents!)).toEqual([
      "a-agent",
      "z-agent",
    ]);
  });

  it("should NOT sort scripts array (order may be meaningful)", async () => {
    const metadata = {
      name: "test-profile",
      version: "1.0.0",
      scripts: ["setup.sh", "build.sh", "cleanup.sh"],
    };

    await writeSkillsetMetadata({ skillsetDir, metadata });

    const result = await readSkillsetMetadata({ skillsetDir });
    expect(result.scripts).toEqual(["setup.sh", "build.sh", "cleanup.sh"]);
  });

  it("should handle null and empty arrays without error", async () => {
    const metadata = {
      name: "test-profile",
      version: "1.0.0",
      skills: null,
      subagents: [],
      keywords: null,
      dependencies: null,
    };

    await writeSkillsetMetadata({ skillsetDir, metadata });

    const result = await readSkillsetMetadata({ skillsetDir });
    expect(result.skills).toBeNull();
    expect(result.subagents).toEqual([]);
    expect(result.keywords).toBeNull();
    expect(result.dependencies).toBeNull();
  });

  it("should not mutate the original metadata object", async () => {
    const metadata = {
      name: "test-profile",
      version: "1.0.0",
      skills: [
        { id: "z-skill", name: "Zebra", description: "Z" },
        { id: "a-skill", name: "Alpha", description: "A" },
      ],
    };

    const originalOrder = metadata.skills.map((s) => s.name);
    await writeSkillsetMetadata({ skillsetDir, metadata });

    expect(metadata.skills.map((s) => s.name)).toEqual(originalOrder);
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

describe("addSubagentToNoriJson", () => {
  let skillsetDir: string;

  beforeEach(async () => {
    skillsetDir = await fs.mkdtemp(path.join(tmpdir(), "nori-metadata-test-"));
  });

  afterEach(async () => {
    await fs.rm(skillsetDir, { recursive: true, force: true });
  });

  it("should create nori.json when none exists and add the subagent", async () => {
    await addSubagentToNoriJson({
      skillsetDir,
      subagentName: "my-subagent",
      version: "*",
    });

    const metadata = await readSkillsetMetadata({ skillsetDir });
    expect(metadata.name).toBe(path.basename(skillsetDir));
    expect(metadata.version).toBe("1.0.0");
    expect(metadata.dependencies?.subagents).toEqual({ "my-subagent": "*" });
  });

  it("should add subagent to existing nori.json preserving other dependencies", async () => {
    await writeSkillsetMetadata({
      skillsetDir,
      metadata: {
        name: "my-profile",
        version: "1.0.0",
        dependencies: {
          skills: { "existing-skill": "^1.0.0" },
        },
      },
    });

    await addSubagentToNoriJson({
      skillsetDir,
      subagentName: "my-subagent",
      version: "^2.0.0",
    });

    const metadata = await readSkillsetMetadata({ skillsetDir });
    expect(metadata.dependencies?.skills).toEqual({
      "existing-skill": "^1.0.0",
    });
    expect(metadata.dependencies?.subagents).toEqual({
      "my-subagent": "^2.0.0",
    });
  });

  it("should update version for an already-present subagent", async () => {
    await writeSkillsetMetadata({
      skillsetDir,
      metadata: {
        name: "my-profile",
        version: "1.0.0",
        dependencies: {
          subagents: { "my-subagent": "^1.0.0" },
        },
      },
    });

    await addSubagentToNoriJson({
      skillsetDir,
      subagentName: "my-subagent",
      version: "*",
    });

    const metadata = await readSkillsetMetadata({ skillsetDir });
    expect(metadata.dependencies?.subagents).toEqual({ "my-subagent": "*" });
  });

  it("should throw when nori.json contains corrupt JSON", async () => {
    await fs.writeFile(
      path.join(skillsetDir, "nori.json"),
      "{ this is not valid json",
    );

    await expect(
      addSubagentToNoriJson({
        skillsetDir,
        subagentName: "my-subagent",
        version: "*",
      }),
    ).rejects.toThrow("nori.json exists but contains invalid JSON");
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

  it("should create nori.json when directory has AGENTS.md but no nori.json", async () => {
    await fs.writeFile(path.join(skillsetDir, "AGENTS.md"), "# My Profile");

    await ensureNoriJson({ skillsetDir });

    const metadata = await readSkillsetMetadata({ skillsetDir });
    expect(metadata.name).toBe(path.basename(skillsetDir));
    expect(metadata.version).toBe("0.0.1");
  });

  it("should create nori.json when directory has CLAUDE.md but no nori.json (backward compat)", async () => {
    await fs.writeFile(path.join(skillsetDir, "CLAUDE.md"), "# My Profile");

    await ensureNoriJson({ skillsetDir });

    const metadata = await readSkillsetMetadata({ skillsetDir });
    expect(metadata.name).toBe(path.basename(skillsetDir));
    expect(metadata.version).toBe("0.0.1");
  });

  it("should set type to skillset on auto-created nori.json", async () => {
    await fs.writeFile(path.join(skillsetDir, "AGENTS.md"), "# My Profile");

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
    await fs.writeFile(path.join(skillsetDir, "AGENTS.md"), "# My Profile");

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
    await fs.writeFile(path.join(skillsetDir, "AGENTS.md"), "# My Profile");

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
