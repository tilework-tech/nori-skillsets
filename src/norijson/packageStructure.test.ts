import { describe, expect, test } from "vitest";

import {
  getPackageStructure,
  skillsetStructure,
  skillStructure,
} from "@/norijson/packageStructure.js";

describe("packageStructure", () => {
  describe("skillsetStructure", () => {
    test("has the correct component paths", () => {
      const paths = skillsetStructure.components.map((c) => c.path);
      expect(paths).toContain("CLAUDE.md");
      expect(paths).toContain("skills");
      expect(paths).toContain("subagents");
      expect(paths).toContain("slashcommands");
      expect(paths).toContain("nori.json");
    });

    test("only nori.json is required", () => {
      const required = skillsetStructure.components.filter((c) => c.required);
      expect(required).toHaveLength(1);
      expect(required[0].path).toBe("nori.json");
    });

    test("directory components have child patterns", () => {
      const dirs = skillsetStructure.components.filter(
        (c) => c.kind === "directory",
      );
      for (const dir of dirs) {
        expect(dir.childPattern).toBeDefined();
        expect(dir.childPattern).not.toBeNull();
      }
    });
  });

  describe("skillStructure", () => {
    test("SKILL.md is required", () => {
      const skillMd = skillStructure.components.find(
        (c) => c.path === "SKILL.md",
      );
      expect(skillMd).toBeDefined();
      expect(skillMd!.required).toBe(true);
    });

    test("nori.json is optional for skills", () => {
      const noriJson = skillStructure.components.find(
        (c) => c.path === "nori.json",
      );
      expect(noriJson).toBeDefined();
      expect(noriJson!.required).toBe(false);
    });
  });

  describe("getPackageStructure", () => {
    test("returns skillset structure for skillset type", () => {
      const result = getPackageStructure({ type: "skillset" });
      expect(result).toBe(skillsetStructure);
    });

    test("returns skill structure for skill type", () => {
      const result = getPackageStructure({ type: "skill" });
      expect(result).toBe(skillStructure);
    });

    test("returns null for inlined-skill (no standalone structure)", () => {
      const result = getPackageStructure({ type: "inlined-skill" });
      expect(result).toBeNull();
    });
  });
});
