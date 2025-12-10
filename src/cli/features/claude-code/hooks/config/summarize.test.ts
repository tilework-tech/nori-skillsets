import { describe, it, expect } from "vitest";

import { isEmptyTranscript } from "./summarize.js";

describe("isEmptyTranscript", () => {
  it("should return true for transcript with only file-history-snapshot messages", () => {
    const emptyTranscript = `{"type":"file-history-snapshot","messageId":"a889f34c-2abb-40b7-8eaf-3da96d82c0a0","snapshot":{}}
{"type":"file-history-snapshot","messageId":"807347dd-3f7d-47e1-a343-4337971f4b88","snapshot":{}}`;

    const result = isEmptyTranscript({ content: emptyTranscript });

    expect(result).toBe(true);
  });

  it("should return false for transcript with user messages", () => {
    const transcriptWithUser = `{"type":"file-history-snapshot","messageId":"abc","snapshot":{}}
{"type":"user","message":{"role":"user","content":"Hello, can you help me?"}}`;

    const result = isEmptyTranscript({ content: transcriptWithUser });

    expect(result).toBe(false);
  });

  it("should return true for transcript with only assistant messages (no user)", () => {
    const transcriptWithAssistant = `{"type":"assistant","message":{"role":"assistant","content":"Sure, I can help!"}}`;

    const result = isEmptyTranscript({ content: transcriptWithAssistant });

    expect(result).toBe(true);
  });

  it("should return false for transcript with user and assistant messages", () => {
    const fullTranscript = `{"type":"user","message":{"role":"user","content":"test"}}
{"type":"assistant","message":{"role":"assistant","content":"response"}}`;

    const result = isEmptyTranscript({ content: fullTranscript });

    expect(result).toBe(false);
  });

  it("should return true for transcript with only summary messages", () => {
    const summaryOnly = `{"type":"summary","summary":"Some summary text"}`;

    const result = isEmptyTranscript({ content: summaryOnly });

    expect(result).toBe(true);
  });

  it("should return true for empty string", () => {
    const result = isEmptyTranscript({ content: "" });

    expect(result).toBe(true);
  });

  it("should return true for whitespace only", () => {
    const result = isEmptyTranscript({ content: "   \n  \n  " });

    expect(result).toBe(true);
  });

  it("should handle invalid JSON gracefully", () => {
    const invalidJson = `{"type":"user","message":not valid json}
{"type":"user","message":{"role":"user","content":"test"}}`;

    const result = isEmptyTranscript({ content: invalidJson });

    // Should return false because second line is valid and has user content
    expect(result).toBe(false);
  });

  it("should return true for assistant messages with tool use but no user message", () => {
    const toolUseTranscript = `{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Let me read that file"},{"type":"tool_use","name":"Read","input":{"file_path":"test.ts"}}]}}`;

    const result = isEmptyTranscript({ content: toolUseTranscript });

    expect(result).toBe(true);
  });

  it("should return true for messages with empty content", () => {
    const emptyContentTranscript = `{"type":"user","message":{"role":"user","content":""}}
{"type":"assistant","message":{"role":"assistant","content":""}}`;

    const result = isEmptyTranscript({ content: emptyContentTranscript });

    expect(result).toBe(true);
  });

  it("should return true for user messages with only whitespace", () => {
    const whitespaceTranscript = `{"type":"user","message":{"role":"user","content":"   \n  "}}`;

    const result = isEmptyTranscript({ content: whitespaceTranscript });

    expect(result).toBe(true);
  });

  it("should return false for user message with array content containing text", () => {
    const arrayContentTranscript = `{"type":"user","message":{"role":"user","content":[{"type":"text","text":"Can you help?"}]}}`;

    const result = isEmptyTranscript({ content: arrayContentTranscript });

    expect(result).toBe(false);
  });

  it("should return true for user message with empty array content", () => {
    const emptyArrayTranscript = `{"type":"user","message":{"role":"user","content":[]}}`;

    const result = isEmptyTranscript({ content: emptyArrayTranscript });

    expect(result).toBe(true);
  });
});
