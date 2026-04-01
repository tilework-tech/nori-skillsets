/**
 * Tests for bundled skillsets installer
 * Verifies that bundled skills are copied to agent skills directories
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { copyBundledSkills } from "./installer.js";

describe("copyBundledSkills", () => {
  let tempDir: string;
  let destSkillsDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bundled-skills-test-"));
    destSkillsDir = path.join(tempDir, "skills");
    await fs.mkdir(destSkillsDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("should copy bundled nori-info skill to destination", async () => {
    await copyBundledSkills({ destSkillsDir, installDir: tempDir });

    const skillPath = path.join(destSkillsDir, "nori-info", "SKILL.md");
    const exists = await fs
      .access(skillPath)
      .then(() => true)
      .catch(() => false);

    expect(exists).toBe(true);

    const content = await fs.readFile(skillPath, "utf-8");
    expect(content).toContain("name: Nori Skillsets");
    expect(content).toContain("nori-skillsets --help");
    expect(content).toContain(
      "https://noriskillsets.dev/docs/building-a-skillset",
    );
    expect(content).toContain(
      "https://github.com/tilework-tech/nori-skillsets",
    );
  });

  it("should not overwrite a skillset-provided skill with the same name", async () => {
    // Pre-create a nori-info skill in the destination (simulates skillset-provided version)
    const existingSkillDir = path.join(destSkillsDir, "nori-info");
    await fs.mkdir(existingSkillDir, { recursive: true });
    await fs.writeFile(
      path.join(existingSkillDir, "SKILL.md"),
      "---\nname: Custom Nori Info\n---\n# Custom version\n",
    );

    await copyBundledSkills({ destSkillsDir, installDir: tempDir });

    // Should still have the skillset-provided version, not the bundled one
    const content = await fs.readFile(
      path.join(existingSkillDir, "SKILL.md"),
      "utf-8",
    );
    expect(content).toContain("Custom Nori Info");
    expect(content).toContain("# Custom version");
  });

  it("should apply template substitution to bundled skill markdown files", async () => {
    await copyBundledSkills({ destSkillsDir, installDir: tempDir });

    const skillPath = path.join(destSkillsDir, "nori-info", "SKILL.md");
    const content = await fs.readFile(skillPath, "utf-8");

    // Should not contain any unsubstituted template variables
    expect(content).not.toContain("{{skills_dir}}");
    expect(content).not.toContain("{{install_dir}}");
  });
});
