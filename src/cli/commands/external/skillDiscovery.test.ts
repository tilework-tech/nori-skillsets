/**
 * Tests for skill discovery in cloned repos
 */

import * as fs from "fs/promises";
import { tmpdir } from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { discoverSkills, parseSkillFrontmatter } from "./skillDiscovery.js";

describe("parseSkillFrontmatter", () => {
  it("should parse name and description from YAML frontmatter", () => {
    const content = `---
name: My Skill
description: A useful skill for testing
---

# My Skill

Some content here.
`;

    const result = parseSkillFrontmatter({ content });

    expect(result).toEqual({
      name: "My Skill",
      description: "A useful skill for testing",
    });
  });

  it("should return null when name is missing", () => {
    const content = `---
description: A skill without a name
---

# No Name
`;

    const result = parseSkillFrontmatter({ content });

    expect(result).toBeNull();
  });

  it("should return null when description is missing", () => {
    const content = `---
name: Name Only
---

# Name Only
`;

    const result = parseSkillFrontmatter({ content });

    expect(result).toBeNull();
  });

  it("should return null when no frontmatter present", () => {
    const content = `# Just Markdown

No frontmatter here.
`;

    const result = parseSkillFrontmatter({ content });

    expect(result).toBeNull();
  });

  it("should handle frontmatter with extra fields", () => {
    const content = `---
name: Extended Skill
description: Has extra fields
version: 1.0.0
author: test
---

# Extended
`;

    const result = parseSkillFrontmatter({ content });

    expect(result).toEqual({
      name: "Extended Skill",
      description: "Has extra fields",
    });
  });

  it("should handle quoted values in frontmatter", () => {
    const content = `---
name: "Quoted Skill"
description: "A skill with: colons and special chars"
---

Content.
`;

    const result = parseSkillFrontmatter({ content });

    expect(result).toEqual({
      name: "Quoted Skill",
      description: "A skill with: colons and special chars",
    });
  });
});

describe("discoverSkills", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(tmpdir(), "nori-discover-test-"));
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it("should discover a skill at the root level", async () => {
    await fs.writeFile(
      path.join(testDir, "SKILL.md"),
      `---
name: Root Skill
description: A skill at the root
---

# Root Skill
`,
    );

    const skills = await discoverSkills({ basePath: testDir });

    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("Root Skill");
    expect(skills[0].description).toBe("A skill at the root");
    expect(skills[0].dirPath).toBe(testDir);
  });

  it("should discover skills in a skills/ subdirectory", async () => {
    const skillDir = path.join(testDir, "skills", "my-skill");
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(
      path.join(skillDir, "SKILL.md"),
      `---
name: My Skill
description: In skills subdir
---

# My Skill
`,
    );

    const skills = await discoverSkills({ basePath: testDir });

    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("My Skill");
  });

  it("should discover skills in nested agent directories like .claude/skills/", async () => {
    const skillDir = path.join(testDir, ".claude", "skills", "claude-skill");
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(
      path.join(skillDir, "SKILL.md"),
      `---
name: Claude Skill
description: In .claude/skills
---

# Claude Skill
`,
    );

    const skills = await discoverSkills({ basePath: testDir });

    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("Claude Skill");
  });

  it("should discover skills in arbitrary directories alongside skills/", async () => {
    // Skill in standard skills/ directory
    const standardSkillDir = path.join(testDir, "skills", "standard-skill");
    await fs.mkdir(standardSkillDir, { recursive: true });
    await fs.writeFile(
      path.join(standardSkillDir, "SKILL.md"),
      `---
name: Standard Skill
description: In skills dir
---
`,
    );

    // Skill in a completely arbitrary directory
    const arbitrarySkillDir = path.join(testDir, "my-tools", "custom-skill");
    await fs.mkdir(arbitrarySkillDir, { recursive: true });
    await fs.writeFile(
      path.join(arbitrarySkillDir, "SKILL.md"),
      `---
name: Custom Skill
description: In an arbitrary directory
---
`,
    );

    const skills = await discoverSkills({ basePath: testDir });

    expect(skills).toHaveLength(2);
    const names = skills.map((s) => s.name).sort();
    expect(names).toEqual(["Custom Skill", "Standard Skill"]);
  });

  it("should discover multiple skills", async () => {
    // Create two skills in skills/
    const skill1Dir = path.join(testDir, "skills", "skill-one");
    const skill2Dir = path.join(testDir, "skills", "skill-two");
    await fs.mkdir(skill1Dir, { recursive: true });
    await fs.mkdir(skill2Dir, { recursive: true });

    await fs.writeFile(
      path.join(skill1Dir, "SKILL.md"),
      `---
name: Skill One
description: First skill
---
`,
    );
    await fs.writeFile(
      path.join(skill2Dir, "SKILL.md"),
      `---
name: Skill Two
description: Second skill
---
`,
    );

    const skills = await discoverSkills({ basePath: testDir });

    expect(skills).toHaveLength(2);
    const names = skills.map((s) => s.name).sort();
    expect(names).toEqual(["Skill One", "Skill Two"]);
  });

  it("should apply subpath filter", async () => {
    const skillDir = path.join(testDir, "specific", "path", "my-skill");
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(
      path.join(skillDir, "SKILL.md"),
      `---
name: Specific Skill
description: In a specific path
---
`,
    );

    const skills = await discoverSkills({
      basePath: testDir,
      subpath: "specific/path",
    });

    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("Specific Skill");
  });

  it("should return empty array when no skills found", async () => {
    const skills = await discoverSkills({ basePath: testDir });

    expect(skills).toEqual([]);
  });

  it("should skip SKILL.md files with invalid frontmatter", async () => {
    const validDir = path.join(testDir, "skills", "valid");
    const invalidDir = path.join(testDir, "skills", "invalid");
    await fs.mkdir(validDir, { recursive: true });
    await fs.mkdir(invalidDir, { recursive: true });

    await fs.writeFile(
      path.join(validDir, "SKILL.md"),
      `---
name: Valid Skill
description: Has proper frontmatter
---
`,
    );
    await fs.writeFile(
      path.join(invalidDir, "SKILL.md"),
      `# No Frontmatter

Just plain markdown.
`,
    );

    const skills = await discoverSkills({ basePath: testDir });

    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("Valid Skill");
  });

  it("should deduplicate skills by name", async () => {
    // Same skill in two locations
    const loc1 = path.join(testDir, "skills", "my-skill");
    const loc2 = path.join(testDir, ".claude", "skills", "my-skill");
    await fs.mkdir(loc1, { recursive: true });
    await fs.mkdir(loc2, { recursive: true });

    const content = `---
name: Duplicate Skill
description: Same name in two places
---
`;
    await fs.writeFile(path.join(loc1, "SKILL.md"), content);
    await fs.writeFile(path.join(loc2, "SKILL.md"), content);

    const skills = await discoverSkills({ basePath: testDir });

    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("Duplicate Skill");
  });

  it("should discover skills recursively as fallback", async () => {
    // Put a skill 3 levels deep, not in a standard directory
    const deepDir = path.join(testDir, "custom", "nested", "deep-skill");
    await fs.mkdir(deepDir, { recursive: true });
    await fs.writeFile(
      path.join(deepDir, "SKILL.md"),
      `---
name: Deep Skill
description: Found by recursive search
---
`,
    );

    const skills = await discoverSkills({ basePath: testDir });

    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("Deep Skill");
  });
});
