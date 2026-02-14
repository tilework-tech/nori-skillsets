/**
 * Tests for ContentCompiler
 * Verifies vocabulary substitution, tag adaptation, and code block handling
 */

import { describe, it, expect } from "vitest";

import { compileContent, type TranslationStrategy } from "./contentCompiler.js";

describe("ContentCompiler", () => {
  describe("Claude Code vocabulary (identity transform)", () => {
    it("passes through content unchanged for claude-code agent", () => {
      const input =
        "Use the TodoWrite tool to manage tasks. Use Read to read files.";
      const result = compileContent({
        content: input,
        agentName: "claude-code",
        strategy: "minimal",
      });
      expect(result).toBe(input);
    });

    it("passes through XML tags unchanged for claude-code agent", () => {
      const input =
        "<required>\nDo this thing.\n</required>\n<system-reminder>Remember this.</system-reminder>";
      const result = compileContent({
        content: input,
        agentName: "claude-code",
        strategy: "minimal",
      });
      expect(result).toBe(input);
    });
  });

  describe("Codex vocabulary substitution", () => {
    it("swaps TodoWrite to update_plan for codex agent", () => {
      const input = "Use the TodoWrite tool to manage your tasks.";
      const result = compileContent({
        content: input,
        agentName: "codex",
        strategy: "minimal",
      });
      expect(result).toContain("update_plan");
      expect(result).not.toContain("TodoWrite");
    });

    it("handles multiple tool name occurrences", () => {
      const input =
        "First use TodoWrite to plan. Then use TodoWrite again to update.";
      const result = compileContent({
        content: input,
        agentName: "codex",
        strategy: "minimal",
      });
      expect(result).not.toContain("TodoWrite");
      // Should contain update_plan twice
      const matches = result.match(/update_plan/g);
      expect(matches).toHaveLength(2);
    });

    it("preserves XML tags in minimal strategy for codex", () => {
      const input = "<required>\nUse TodoWrite here.\n</required>";
      const result = compileContent({
        content: input,
        agentName: "codex",
        strategy: "minimal",
      });
      expect(result).toContain("<required>");
      expect(result).toContain("</required>");
      expect(result).toContain("update_plan");
    });
  });

  describe("code block protection", () => {
    it("does not substitute tool names inside fenced code blocks", () => {
      const input = [
        "Use TodoWrite to plan.",
        "",
        "```typescript",
        'TodoWrite({ todos: [{ content: "test" }] })',
        "```",
        "",
        "Then continue with TodoWrite.",
      ].join("\n");
      const result = compileContent({
        content: input,
        agentName: "codex",
        strategy: "minimal",
      });
      // Prose should be substituted
      expect(result).toContain("Use update_plan to plan.");
      expect(result).toContain("Then continue with update_plan.");
      // Code block should be preserved exactly
      expect(result).toContain('TodoWrite({ todos: [{ content: "test" }] })');
    });

    it("handles multiple code blocks", () => {
      const input = [
        "Use TodoWrite.",
        "",
        "```",
        "TodoWrite()",
        "```",
        "",
        "Middle TodoWrite.",
        "",
        "```ts",
        "TodoWrite()",
        "```",
        "",
        "End TodoWrite.",
      ].join("\n");
      const result = compileContent({
        content: input,
        agentName: "codex",
        strategy: "minimal",
      });
      // All prose TodoWrite should be replaced
      expect(result).toContain("Use update_plan.");
      expect(result).toContain("Middle update_plan.");
      expect(result).toContain("End update_plan.");
      // Both code blocks should preserve TodoWrite
      const codeBlockMatches = result.match(/TodoWrite\(\)/g);
      expect(codeBlockMatches).toHaveLength(2);
    });

    it("handles inline code (backtick-wrapped) by not substituting", () => {
      const input = "Run `TodoWrite` to update. Also use TodoWrite directly.";
      const result = compileContent({
        content: input,
        agentName: "codex",
        strategy: "minimal",
      });
      expect(result).toContain("`TodoWrite`");
      expect(result).toContain("use update_plan directly");
    });
  });

  describe("unknown content", () => {
    it("leaves unknown text unchanged", () => {
      const input = "This has no tool references at all.";
      const result = compileContent({
        content: input,
        agentName: "codex",
        strategy: "minimal",
      });
      expect(result).toBe(input);
    });

    it("leaves empty content unchanged", () => {
      const result = compileContent({
        content: "",
        agentName: "codex",
        strategy: "minimal",
      });
      expect(result).toBe("");
    });
  });

  describe("translation strategies", () => {
    const strategies: Array<TranslationStrategy> = ["minimal", "full"];

    for (const strategy of strategies) {
      it(`works with ${strategy} strategy`, () => {
        const input = "Use TodoWrite to manage tasks.";
        const result = compileContent({
          content: input,
          agentName: "codex",
          strategy,
        });
        expect(result).toContain("update_plan");
      });
    }
  });
});
