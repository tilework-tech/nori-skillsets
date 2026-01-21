/**
 * Tests for CLI command name mapping
 */

import { describe, it, expect } from "vitest";

import { getCommandNames } from "./cliCommandNames.js";

describe("cliCommandNames", () => {
  describe("getCommandNames", () => {
    it("should return nori-ai command names when cliName is nori-ai", () => {
      const names = getCommandNames({ cliName: "nori-ai" });

      expect(names.download).toBe("registry-download");
      expect(names.downloadSkill).toBe("skill-download");
      expect(names.search).toBe("registry-search");
      expect(names.update).toBe("registry-update");
      expect(names.upload).toBe("registry-upload");
      expect(names.uploadSkill).toBe("skill-upload");
      expect(names.switchProfile).toBe("switch-profile");
    });

    it("should return seaweed command names when cliName is seaweed", () => {
      const names = getCommandNames({ cliName: "seaweed" });

      expect(names.download).toBe("download");
      expect(names.downloadSkill).toBe("download-skill");
      expect(names.search).toBe("search");
      expect(names.update).toBe("update");
      expect(names.upload).toBe("upload");
      expect(names.uploadSkill).toBe("upload-skill");
      expect(names.switchProfile).toBe("switch-skillset");
    });

    it("should default to nori-ai command names when cliName is null", () => {
      const names = getCommandNames({ cliName: null });

      expect(names.download).toBe("registry-download");
      expect(names.switchProfile).toBe("switch-profile");
    });

    it("should default to nori-ai command names when cliName is undefined", () => {
      const names = getCommandNames({});

      expect(names.download).toBe("registry-download");
      expect(names.switchProfile).toBe("switch-profile");
    });
  });
});
