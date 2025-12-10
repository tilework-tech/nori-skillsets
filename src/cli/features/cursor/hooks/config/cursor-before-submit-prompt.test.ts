/**
 * Tests for cursor-before-submit-prompt adapter
 * Verifies transformation of Cursor input to slash command interception
 */

import { describe, it, expect } from "vitest";

import {
  transformCursorInput,
  transformOutput,
  type CursorBeforeSubmitPromptInput,
} from "./cursor-before-submit-prompt.js";

describe("cursor-before-submit-prompt", () => {
  describe("transformCursorInput", () => {
    it("should transform Cursor input to Claude Code format", () => {
      const cursorInput: CursorBeforeSubmitPromptInput = {
        conversation_id: "test-conv-123",
        generation_id: "test-gen-456",
        model: "gpt-4",
        hook_event_name: "beforeSubmitPrompt",
        cursor_version: "1.7.0",
        workspace_roots: ["/home/user/project"],
        user_email: "test@example.com",
        prompt: "/nori-switch-profile senior-swe",
        attachments: [],
      };

      const result = transformCursorInput({ input: cursorInput });

      expect(result.prompt).toBe("/nori-switch-profile senior-swe");
      expect(result.cwd).toBe("/home/user/project");
      expect(result.session_id).toBe("test-conv-123");
      expect(result.hook_event_name).toBe("UserPromptSubmit");
    });

    it("should use first workspace root as cwd", () => {
      const cursorInput: CursorBeforeSubmitPromptInput = {
        conversation_id: "test-conv-123",
        generation_id: "test-gen-456",
        model: "gpt-4",
        hook_event_name: "beforeSubmitPrompt",
        cursor_version: "1.7.0",
        workspace_roots: ["/home/user/project1", "/home/user/project2"],
        user_email: "test@example.com",
        prompt: "test prompt",
        attachments: [],
      };

      const result = transformCursorInput({ input: cursorInput });

      expect(result.cwd).toBe("/home/user/project1");
    });

    it("should handle empty workspace roots", () => {
      const cursorInput: CursorBeforeSubmitPromptInput = {
        conversation_id: "test-conv-123",
        generation_id: "test-gen-456",
        model: "gpt-4",
        hook_event_name: "beforeSubmitPrompt",
        cursor_version: "1.7.0",
        workspace_roots: [],
        user_email: "test@example.com",
        prompt: "test prompt",
        attachments: [],
      };

      const result = transformCursorInput({ input: cursorInput });

      // Should fallback to process.cwd()
      expect(result.cwd).toBeDefined();
    });
  });

  describe("transformOutput", () => {
    it("should transform block decision to Cursor format", () => {
      const claudeOutput = {
        decision: "block" as const,
        reason: "Profile switched successfully",
      };

      const result = transformOutput({ output: claudeOutput });

      expect(result.continue).toBe(false);
      expect(result.user_message).toBe("Profile switched successfully");
    });

    it("should return continue: true for null output", () => {
      const result = transformOutput({ output: null });

      expect(result.continue).toBe(true);
      expect(result.user_message).toBeUndefined();
    });

    it("should return continue: true for output without decision", () => {
      const claudeOutput = {
        hookSpecificOutput: {
          hookEventName: "UserPromptSubmit",
          additionalContext: "some context",
        },
      };

      const result = transformOutput({ output: claudeOutput });

      expect(result.continue).toBe(true);
    });
  });
});
