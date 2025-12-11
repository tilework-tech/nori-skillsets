/**
 * Tests for cursor-agent slash command intercept hook
 * Verifies Cursor's beforeSubmitPrompt input format is correctly handled
 */

import { describe, it, expect } from "vitest";

import type { CursorHookInput } from "./intercepted-slashcommands/types.js";

// We'll test the processInput function which handles the Cursor input format
import { processInput, translateOutput } from "./slash-command-intercept.js";

describe("cursor-agent slash-command-intercept", () => {
  describe("processInput", () => {
    it("should extract prompt from Cursor hook input", () => {
      const cursorInput: CursorHookInput = {
        prompt: "/nori-switch-profile amol",
        hook_event_name: "beforeSubmitPrompt",
        workspace_roots: ["/home/user/project"],
      };

      const result = processInput({ input: cursorInput });

      expect(result.prompt).toBe("/nori-switch-profile amol");
    });

    it("should use first workspace_root as cwd", () => {
      const cursorInput: CursorHookInput = {
        prompt: "/nori-switch-profile",
        hook_event_name: "beforeSubmitPrompt",
        workspace_roots: ["/home/user/project", "/home/user/other"],
      };

      const result = processInput({ input: cursorInput });

      expect(result.cwd).toBe("/home/user/project");
    });

    it("should use home directory when workspace_roots is empty", () => {
      const cursorInput: CursorHookInput = {
        prompt: "/nori-switch-profile",
        hook_event_name: "beforeSubmitPrompt",
        workspace_roots: [],
      };

      const result = processInput({ input: cursorInput });

      // Should fall back to home directory
      expect(result.cwd).toBeDefined();
      expect(result.cwd.length).toBeGreaterThan(0);
    });

    it("should use home directory when workspace_roots is undefined", () => {
      const cursorInput: CursorHookInput = {
        prompt: "/nori-switch-profile",
        hook_event_name: "beforeSubmitPrompt",
      };

      const result = processInput({ input: cursorInput });

      expect(result.cwd).toBeDefined();
      expect(result.cwd.length).toBeGreaterThan(0);
    });

    it("should preserve hook_event_name", () => {
      const cursorInput: CursorHookInput = {
        prompt: "/nori-switch-profile",
        hook_event_name: "beforeSubmitPrompt",
        workspace_roots: ["/home/user/project"],
      };

      const result = processInput({ input: cursorInput });

      expect(result.hook_event_name).toBe("beforeSubmitPrompt");
    });
  });

  describe("translateOutput", () => {
    it("should translate block decision to continue: false", () => {
      const internalOutput = {
        decision: "block" as const,
        reason: "Profile switched successfully",
      };

      const cursorOutput = translateOutput({ output: internalOutput });

      expect(cursorOutput.continue).toBe(false);
      expect(cursorOutput.user_message).toBe("Profile switched successfully");
    });

    it("should translate null output to continue: true", () => {
      const cursorOutput = translateOutput({ output: null });

      expect(cursorOutput.continue).toBe(true);
      expect(cursorOutput.user_message).toBeUndefined();
    });

    it("should translate output without decision to continue: true", () => {
      const internalOutput = {};

      const cursorOutput = translateOutput({ output: internalOutput });

      expect(cursorOutput.continue).toBe(true);
    });

    it("should handle output with decision but no reason", () => {
      const internalOutput = {
        decision: "block" as const,
      };

      const cursorOutput = translateOutput({ output: internalOutput });

      expect(cursorOutput.continue).toBe(false);
      expect(cursorOutput.user_message).toBeUndefined();
    });
  });
});
