import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { loadSkillsetPackage } from "@/norijson/packageStructure.js";

describe("loadSkillsetPackage", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "test-load-skillset-pkg-"),
    );
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test("loads a full skillset with all components", async () => {
    // Set up a profile directory with all components
    await fs.writeFile(
      path.join(tempDir, "CLAUDE.md"),
      "# My Profile\nInstructions here",
    );

    // Skills
    const skill1Dir = path.join(tempDir, "skills", "debugging");
    const skill2Dir = path.join(tempDir, "skills", "testing");
    await fs.mkdir(skill1Dir, { recursive: true });
    await fs.mkdir(skill2Dir, { recursive: true });
    await fs.writeFile(
      path.join(skill1Dir, "SKILL.md"),
      "---\nname: debugging\n---\nDebug skill",
    );
    await fs.writeFile(
      path.join(skill2Dir, "SKILL.md"),
      "---\nname: testing\n---\nTest skill",
    );

    // Subagents
    await fs.mkdir(path.join(tempDir, "subagents"), { recursive: true });
    await fs.writeFile(
      path.join(tempDir, "subagents", "code-reviewer.md"),
      "Review code",
    );
    await fs.writeFile(
      path.join(tempDir, "subagents", "researcher.md"),
      "Research things",
    );

    // Slash commands
    await fs.mkdir(path.join(tempDir, "slashcommands"), { recursive: true });
    await fs.writeFile(
      path.join(tempDir, "slashcommands", "commit.md"),
      "Commit changes",
    );

    const pkg = await loadSkillsetPackage({ profileDir: tempDir });

    expect(pkg.claudeMd).toBe("# My Profile\nInstructions here");

    expect(pkg.skills).toHaveLength(2);
    const skillIds = pkg.skills.map((s) => s.id).sort();
    expect(skillIds).toEqual(["debugging", "testing"]);
    for (const skill of pkg.skills) {
      expect(skill.sourceDir).toBe(path.join(tempDir, "skills", skill.id));
    }

    expect(pkg.subagents).toHaveLength(2);
    const subagentNames = pkg.subagents.map((s) => s.filename).sort();
    expect(subagentNames).toEqual(["code-reviewer.md", "researcher.md"]);
    expect(
      pkg.subagents.find((s) => s.filename === "code-reviewer.md")?.content,
    ).toBe("Review code");

    expect(pkg.slashcommands).toHaveLength(1);
    expect(pkg.slashcommands[0].filename).toBe("commit.md");
    expect(pkg.slashcommands[0].content).toBe("Commit changes");
  });

  test("returns null claudeMd when CLAUDE.md is missing", async () => {
    // Empty profile dir - just needs to exist
    const pkg = await loadSkillsetPackage({ profileDir: tempDir });
    expect(pkg.claudeMd).toBeNull();
  });

  test("returns empty skills when skills/ directory is missing", async () => {
    const pkg = await loadSkillsetPackage({ profileDir: tempDir });
    expect(pkg.skills).toEqual([]);
  });

  test("returns empty subagents when subagents/ directory is missing", async () => {
    const pkg = await loadSkillsetPackage({ profileDir: tempDir });
    expect(pkg.subagents).toEqual([]);
  });

  test("returns empty slashcommands when slashcommands/ directory is missing", async () => {
    const pkg = await loadSkillsetPackage({ profileDir: tempDir });
    expect(pkg.slashcommands).toEqual([]);
  });

  test("returns all empty/null for a bare profile directory", async () => {
    const pkg = await loadSkillsetPackage({ profileDir: tempDir });
    expect(pkg.claudeMd).toBeNull();
    expect(pkg.skills).toEqual([]);
    expect(pkg.subagents).toEqual([]);
    expect(pkg.slashcommands).toEqual([]);
  });

  test("excludes docs.md from subagents", async () => {
    await fs.mkdir(path.join(tempDir, "subagents"), { recursive: true });
    await fs.writeFile(
      path.join(tempDir, "subagents", "docs.md"),
      "Documentation",
    );
    await fs.writeFile(
      path.join(tempDir, "subagents", "reviewer.md"),
      "Review",
    );

    const pkg = await loadSkillsetPackage({ profileDir: tempDir });
    expect(pkg.subagents).toHaveLength(1);
    expect(pkg.subagents[0].filename).toBe("reviewer.md");
  });

  test("excludes docs.md from slashcommands", async () => {
    await fs.mkdir(path.join(tempDir, "slashcommands"), { recursive: true });
    await fs.writeFile(
      path.join(tempDir, "slashcommands", "docs.md"),
      "Documentation",
    );
    await fs.writeFile(
      path.join(tempDir, "slashcommands", "commit.md"),
      "Commit",
    );

    const pkg = await loadSkillsetPackage({ profileDir: tempDir });
    expect(pkg.slashcommands).toHaveLength(1);
    expect(pkg.slashcommands[0].filename).toBe("commit.md");
  });

  test("excludes non-directory entries from skills", async () => {
    await fs.mkdir(path.join(tempDir, "skills"), { recursive: true });
    // A regular file at skills root should be excluded
    await fs.writeFile(path.join(tempDir, "skills", "README.md"), "Read me");
    // A directory should be included
    const skillDir = path.join(tempDir, "skills", "my-skill");
    await fs.mkdir(skillDir);
    await fs.writeFile(path.join(skillDir, "SKILL.md"), "skill content");

    const pkg = await loadSkillsetPackage({ profileDir: tempDir });
    expect(pkg.skills).toHaveLength(1);
    expect(pkg.skills[0].id).toBe("my-skill");
  });
});
