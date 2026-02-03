/**
 * Tests for @clack/prompts validation functions
 *
 * These validators return undefined for valid input, or an error message string
 * for invalid input, matching @clack/prompts validation callback signature.
 */

import { describe, it, expect } from "vitest";

import {
  validateProfileName,
  validateOrgId,
  validateRequired,
} from "@/cli/prompts/validators.js";

describe("validators", () => {
  describe("validateProfileName", () => {
    it("returns error for empty string", () => {
      const result = validateProfileName({ value: "" });
      expect(result).toBe("Profile name is required");
    });

    it("returns error for whitespace-only string", () => {
      const result = validateProfileName({ value: "   " });
      expect(result).toBe("Profile name is required");
    });

    it("returns error for uppercase letters", () => {
      const result = validateProfileName({ value: "MyProfile" });
      expect(result).toBe("Use lowercase letters, numbers, and hyphens only");
    });

    it("returns error for spaces", () => {
      const result = validateProfileName({ value: "my profile" });
      expect(result).toBe("Use lowercase letters, numbers, and hyphens only");
    });

    it("returns error for special characters", () => {
      const result = validateProfileName({ value: "my_profile" });
      expect(result).toBe("Use lowercase letters, numbers, and hyphens only");
    });

    it("returns error for leading hyphen", () => {
      const result = validateProfileName({ value: "-profile" });
      expect(result).toBe("Use lowercase letters, numbers, and hyphens only");
    });

    it("returns error for trailing hyphen", () => {
      const result = validateProfileName({ value: "profile-" });
      expect(result).toBe("Use lowercase letters, numbers, and hyphens only");
    });

    it("returns undefined for valid name with letters only", () => {
      const result = validateProfileName({ value: "myprofile" });
      expect(result).toBeUndefined();
    });

    it("returns undefined for valid name with numbers", () => {
      const result = validateProfileName({ value: "profile123" });
      expect(result).toBeUndefined();
    });

    it("returns undefined for valid name with hyphens", () => {
      const result = validateProfileName({ value: "my-profile-name" });
      expect(result).toBeUndefined();
    });

    it("returns undefined for valid name with numbers and hyphens", () => {
      const result = validateProfileName({ value: "my-profile-123" });
      expect(result).toBeUndefined();
    });
  });

  describe("validateOrgId", () => {
    it("returns error for empty string", () => {
      const result = validateOrgId({ value: "" });
      expect(result).toBe("Organization ID is required");
    });

    it("returns error for whitespace-only string", () => {
      const result = validateOrgId({ value: "   " });
      expect(result).toBe("Organization ID is required");
    });

    it("returns error for uppercase letters", () => {
      const result = validateOrgId({ value: "MyOrg" });
      expect(result).toBe("Use lowercase letters, numbers, and hyphens only");
    });

    it("returns error for spaces", () => {
      const result = validateOrgId({ value: "my org" });
      expect(result).toBe("Use lowercase letters, numbers, and hyphens only");
    });

    it("returns error for special characters", () => {
      const result = validateOrgId({ value: "my_org" });
      expect(result).toBe("Use lowercase letters, numbers, and hyphens only");
    });

    it("returns error for leading hyphen", () => {
      const result = validateOrgId({ value: "-org" });
      expect(result).toBe("Use lowercase letters, numbers, and hyphens only");
    });

    it("returns error for trailing hyphen", () => {
      const result = validateOrgId({ value: "org-" });
      expect(result).toBe("Use lowercase letters, numbers, and hyphens only");
    });

    it("returns undefined for valid org id with letters only", () => {
      const result = validateOrgId({ value: "myorg" });
      expect(result).toBeUndefined();
    });

    it("returns undefined for valid org id with numbers", () => {
      const result = validateOrgId({ value: "org123" });
      expect(result).toBeUndefined();
    });

    it("returns undefined for valid org id with hyphens", () => {
      const result = validateOrgId({ value: "my-org-name" });
      expect(result).toBeUndefined();
    });
  });

  describe("validateRequired", () => {
    it("returns error for empty string with default message", () => {
      const result = validateRequired({ value: "" });
      expect(result).toBe("This field is required");
    });

    it("returns error for whitespace-only string with default message", () => {
      const result = validateRequired({ value: "   " });
      expect(result).toBe("This field is required");
    });

    it("returns error with custom field name", () => {
      const result = validateRequired({ value: "", fieldName: "Email" });
      expect(result).toBe("Email is required");
    });

    it("returns undefined for non-empty string", () => {
      const result = validateRequired({ value: "some value" });
      expect(result).toBeUndefined();
    });

    it("returns undefined for string with leading/trailing whitespace", () => {
      const result = validateRequired({ value: "  value  " });
      expect(result).toBeUndefined();
    });
  });
});
