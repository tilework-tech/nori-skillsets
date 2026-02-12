/**
 * Tests for CLI command name mapping
 */

import { describe, it, expect } from "vitest";

import { getCommandNames } from "./cliCommandNames.js";

describe("cliCommandNames", () => {
  describe("getCommandNames", () => {
    it("should return nori-skillsets command names when cliName is nori-skillsets", () => {
      const names = getCommandNames({ cliName: "nori-skillsets" });

      expect(names.download).toBe("download");
      expect(names.downloadSkill).toBe("download-skill");
      expect(names.search).toBe("search");
      expect(names.update).toBe("update");
      expect(names.upload).toBe("upload");
      expect(names.uploadSkill).toBe("upload-skill");
      expect(names.switchProfile).toBe("switch");
    });

    it("should default to nori-skillsets command names when cliName is null", () => {
      const names = getCommandNames({ cliName: null });

      expect(names.download).toBe("download");
      expect(names.switchProfile).toBe("switch");
    });

    it("should default to nori-skillsets command names when cliName is undefined", () => {
      const names = getCommandNames({});

      expect(names.download).toBe("download");
      expect(names.switchProfile).toBe("switch");
    });
  });
});
