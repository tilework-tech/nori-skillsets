/**
 * Tests for @clack/prompts validation functions
 *
 * These validators return undefined for valid input, or an error message string
 * for invalid input, matching @clack/prompts validation callback signature.
 */

import { describe, it, expect } from "vitest";

import { validateSkillsetName } from "@/cli/prompts/validators.js";

describe("validators", () => {
  describe("validateSkillsetName", () => {
    it("returns error for empty string", () => {
      const result = validateSkillsetName({ value: "" });
      expect(result).toBe("Skillset name is required");
    });

    it("returns error for whitespace-only string", () => {
      const result = validateSkillsetName({ value: "   " });
      expect(result).toBe("Skillset name is required");
    });

    it("returns error for uppercase letters", () => {
      const result = validateSkillsetName({ value: "MyProfile" });
      expect(result).toBe("Use lowercase letters, numbers, and hyphens only");
    });

    it("returns error for spaces", () => {
      const result = validateSkillsetName({ value: "my profile" });
      expect(result).toBe("Use lowercase letters, numbers, and hyphens only");
    });

    it("returns error for special characters", () => {
      const result = validateSkillsetName({ value: "my_profile" });
      expect(result).toBe("Use lowercase letters, numbers, and hyphens only");
    });

    it("returns error for leading hyphen", () => {
      const result = validateSkillsetName({ value: "-profile" });
      expect(result).toBe("Use lowercase letters, numbers, and hyphens only");
    });

    it("returns error for trailing hyphen", () => {
      const result = validateSkillsetName({ value: "profile-" });
      expect(result).toBe("Use lowercase letters, numbers, and hyphens only");
    });

    it("returns undefined for valid name with letters only", () => {
      const result = validateSkillsetName({ value: "myprofile" });
      expect(result).toBeUndefined();
    });

    it("returns undefined for valid name with numbers", () => {
      const result = validateSkillsetName({ value: "profile123" });
      expect(result).toBeUndefined();
    });

    it("returns undefined for valid name with hyphens", () => {
      const result = validateSkillsetName({ value: "my-profile-name" });
      expect(result).toBeUndefined();
    });

    it("returns undefined for valid name with numbers and hyphens", () => {
      const result = validateSkillsetName({ value: "my-profile-123" });
      expect(result).toBeUndefined();
    });
  });
});
