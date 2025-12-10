import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import * as pathUtils from "@/utils/path.js";

import {
  parseSkillUsage,
  parseSubagentUsage,
  detectNoriClaudeMd,
  countMessages,
  countToolUsage,
  formatStatistics,
} from "./statistics.js";

describe("parseSkillUsage", () => {
  it("should extract skill name from Read tool targeting SKILL.md", () => {
    const transcript = `{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"toolu_123","name":"Read","input":{"file_path":"/home/user/.claude/skills/test-driven-development/SKILL.md"}}]}}`;

    const result = parseSkillUsage({ content: transcript });

    expect(result).toEqual({ "test-driven-development": 1 });
  });

  it("should count multiple uses of same skill", () => {
    const transcript = `{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"toolu_1","name":"Read","input":{"file_path":"/home/user/.claude/skills/writing-plans/SKILL.md"}}]}}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"toolu_2","name":"Read","input":{"file_path":"/home/user/.claude/skills/writing-plans/SKILL.md"}}]}}`;

    const result = parseSkillUsage({ content: transcript });

    expect(result).toEqual({ "writing-plans": 2 });
  });

  it("should count different skills separately", () => {
    const transcript = `{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"toolu_1","name":"Read","input":{"file_path":"/home/user/.claude/skills/test-driven-development/SKILL.md"}}]}}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"toolu_2","name":"Read","input":{"file_path":"/home/user/.claude/skills/writing-plans/SKILL.md"}}]}}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"toolu_3","name":"Read","input":{"file_path":"/home/user/.claude/skills/test-driven-development/SKILL.md"}}]}}`;

    const result = parseSkillUsage({ content: transcript });

    expect(result).toEqual({
      "test-driven-development": 2,
      "writing-plans": 1,
    });
  });

  it("should ignore Read tool calls to non-skill files", () => {
    const transcript = `{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"toolu_1","name":"Read","input":{"file_path":"/home/user/project/src/index.ts"}}]}}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"toolu_2","name":"Read","input":{"file_path":"/home/user/.claude/skills/writing-plans/SKILL.md"}}]}}`;

    const result = parseSkillUsage({ content: transcript });

    expect(result).toEqual({ "writing-plans": 1 });
  });

  it("should return empty object when no skills used", () => {
    const transcript = `{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"toolu_1","name":"Bash","input":{"command":"ls"}}]}}`;

    const result = parseSkillUsage({ content: transcript });

    expect(result).toEqual({});
  });

  it("should handle tilde path for skills directory", () => {
    const transcript = `{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"toolu_1","name":"Read","input":{"file_path":"~/.claude/skills/recall/SKILL.md"}}]}}`;

    const result = parseSkillUsage({ content: transcript });

    expect(result).toEqual({ recall: 1 });
  });
});

describe("parseSubagentUsage", () => {
  it("should extract subagent_type from Task tool invocations", () => {
    const transcript = `{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"toolu_123","name":"Task","input":{"subagent_type":"nori-knowledge-researcher","description":"Research something","prompt":"Find info about..."}}]}}`;

    const result = parseSubagentUsage({ content: transcript });

    expect(result).toEqual({ "nori-knowledge-researcher": 1 });
  });

  it("should count multiple uses of same subagent type", () => {
    const transcript = `{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"toolu_1","name":"Task","input":{"subagent_type":"Explore","description":"Explore codebase","prompt":"Find files..."}}]}}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"toolu_2","name":"Task","input":{"subagent_type":"Explore","description":"Explore more","prompt":"Find more..."}}]}}`;

    const result = parseSubagentUsage({ content: transcript });

    expect(result).toEqual({ Explore: 2 });
  });

  it("should count different subagent types separately", () => {
    const transcript = `{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"toolu_1","name":"Task","input":{"subagent_type":"nori-knowledge-researcher","description":"Research","prompt":"..."}}]}}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"toolu_2","name":"Task","input":{"subagent_type":"Explore","description":"Explore","prompt":"..."}}]}}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"toolu_3","name":"Task","input":{"subagent_type":"nori-knowledge-researcher","description":"More research","prompt":"..."}}]}}`;

    const result = parseSubagentUsage({ content: transcript });

    expect(result).toEqual({
      "nori-knowledge-researcher": 2,
      Explore: 1,
    });
  });

  it("should return empty object when no subagents used", () => {
    const transcript = `{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"toolu_1","name":"Read","input":{"file_path":"test.ts"}}]}}`;

    const result = parseSubagentUsage({ content: transcript });

    expect(result).toEqual({});
  });

  it("should ignore Task tool calls without subagent_type", () => {
    const transcript = `{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"toolu_1","name":"Task","input":{"description":"Something","prompt":"..."}}]}}`;

    const result = parseSubagentUsage({ content: transcript });

    expect(result).toEqual({});
  });
});

describe("detectNoriClaudeMd", () => {
  it("should return true if transcript contains NORI-AI MANAGED BLOCK reference", () => {
    const transcript = `{"type":"user","message":{"role":"user","content":"Help me with something"}}
{"type":"assistant","message":{"role":"assistant","content":"I see you have NORI-AI MANAGED BLOCK in your CLAUDE.md"}}`;

    const result = detectNoriClaudeMd({ content: transcript });

    expect(result).toBe(true);
  });

  it("should return true if assistant says Following Nori workflow", () => {
    const transcript = `{"type":"user","message":{"role":"user","content":"Build a feature"}}
{"type":"assistant","message":{"role":"assistant","content":"Following Nori workflow...\n\nLet me start by reading the skills."}}`;

    const result = detectNoriClaudeMd({ content: transcript });

    expect(result).toBe(true);
  });

  it("should return false if neither indicator present", () => {
    const transcript = `{"type":"user","message":{"role":"user","content":"Hello"}}
{"type":"assistant","message":{"role":"assistant","content":"Hi! How can I help you today?"}}`;

    const result = detectNoriClaudeMd({ content: transcript });

    expect(result).toBe(false);
  });

  it("should return true for BEGIN NORI-AI MANAGED BLOCK marker", () => {
    const transcript = `{"type":"assistant","message":{"role":"assistant","content":"I see your CLAUDE.md contains # BEGIN NORI-AI MANAGED BLOCK"}}`;

    const result = detectNoriClaudeMd({ content: transcript });

    expect(result).toBe(true);
  });
});

describe("countMessages", () => {
  it("should count user and assistant messages separately", () => {
    const transcript = `{"type":"user","message":{"role":"user","content":"Hello"}}
{"type":"assistant","message":{"role":"assistant","content":"Hi!"}}
{"type":"user","message":{"role":"user","content":"Help me"}}
{"type":"assistant","message":{"role":"assistant","content":"Sure"}}
{"type":"assistant","message":{"role":"assistant","content":"Here you go"}}`;

    const result = countMessages({ content: transcript });

    expect(result).toEqual({ user: 2, assistant: 3 });
  });

  it("should return zeros for empty transcript", () => {
    const result = countMessages({ content: "" });

    expect(result).toEqual({ user: 0, assistant: 0 });
  });

  it("should ignore non-message types", () => {
    const transcript = `{"type":"file-history-snapshot","snapshot":{}}
{"type":"user","message":{"role":"user","content":"Hello"}}
{"type":"summary","summary":"Some summary"}`;

    const result = countMessages({ content: transcript });

    expect(result).toEqual({ user: 1, assistant: 0 });
  });
});

describe("countToolUsage", () => {
  it("should count tool usage by tool name", () => {
    const transcript = `{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","name":"Read","input":{}}]}}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","name":"Bash","input":{}}]}}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","name":"Read","input":{}}]}}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","name":"Edit","input":{}}]}}`;

    const result = countToolUsage({ content: transcript });

    expect(result).toEqual({ Read: 2, Bash: 1, Edit: 1 });
  });

  it("should handle multiple tool uses in single message", () => {
    const transcript = `{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","name":"Read","input":{}},{"type":"tool_use","name":"Grep","input":{}}]}}`;

    const result = countToolUsage({ content: transcript });

    expect(result).toEqual({ Read: 1, Grep: 1 });
  });

  it("should return empty object when no tools used", () => {
    const transcript = `{"type":"assistant","message":{"role":"assistant","content":"Just text, no tools"}}`;

    const result = countToolUsage({ content: transcript });

    expect(result).toEqual({});
  });
});

describe("formatStatistics", () => {
  it("should format complete statistics as ASCII table", () => {
    const result = formatStatistics({
      messages: { user: 12, assistant: 45 },
      tools: { Read: 23, Bash: 15, Edit: 8 },
      skills: { "test-driven-development": 3, "writing-plans": 1 },
      subagents: { "nori-knowledge-researcher": 2 },
      noriClaudeMdUsed: true,
    });

    // Should contain key sections
    expect(result).toContain("Session Statistics");
    expect(result).toContain("Messages");
    expect(result).toContain("User: 12");
    expect(result).toContain("Assistant: 45");
    expect(result).toContain("Tool Calls");
    expect(result).toContain("Read: 23");
    expect(result).toContain("Skills Used");
    expect(result).toContain("test-driven-development");
    expect(result).toContain("3x");
    expect(result).toContain("Subagents Used");
    expect(result).toContain("nori-knowledge-researcher");
    expect(result).toContain("Nori CLAUDE.md: active");
  });

  it("should show none when no skills used", () => {
    const result = formatStatistics({
      messages: { user: 1, assistant: 1 },
      tools: { Read: 1 },
      skills: {},
      subagents: {},
      noriClaudeMdUsed: false,
    });

    expect(result).toContain("Skills Used");
    expect(result).toContain("(none)");
    expect(result).toContain("Subagents Used");
    expect(result).toContain("(none)");
    expect(result).toContain("Nori CLAUDE.md: not detected");
  });

  it("should handle empty statistics gracefully", () => {
    const result = formatStatistics({
      messages: { user: 0, assistant: 0 },
      tools: {},
      skills: {},
      subagents: {},
      noriClaudeMdUsed: false,
    });

    expect(result).toContain("Session Statistics");
    expect(result).toContain("User: 0");
  });
});

describe("statistics hook script behavior", () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let originalStdin: typeof process.stdin;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {
      // Mock implementation
    });

    // Mock getInstallDirs to return a valid installation directory
    vi.spyOn(pathUtils, "getInstallDirs").mockReturnValue([process.cwd()]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should NOT output async:true - hook must run synchronously", async () => {
    // This test verifies the fix for the statistics exit card not showing.
    // The bug was: hook outputs { async: true } first, then systemMessage later.
    // Claude Code stops reading stdout after seeing { async: true }, so
    // the systemMessage was lost.
    //
    // The fix: Remove { async: true } so the hook runs synchronously and
    // the systemMessage is the only output.

    // Import the main function from statistics
    const { main } = await import("./statistics.js");

    // Create mock stdin with a valid transcript (as Buffer for proper handling)
    const transcript = `{"type":"user","message":{"role":"user","content":"Hello"}}
{"type":"assistant","message":{"role":"assistant","content":"Hi!"}}`;

    // Mock stdin to provide transcript data as Buffer chunks
    const { Readable } = await import("stream");
    const mockStdin = new Readable({
      read() {
        this.push(Buffer.from(transcript));
        this.push(null); // Signal end of stream
      },
    });

    // Replace process.stdin temporarily
    originalStdin = process.stdin;
    Object.defineProperty(process, "stdin", {
      value: mockStdin,
      writable: true,
      configurable: true,
    });

    try {
      await main();

      // Verify that { async: true } was NOT output
      const allCalls = consoleLogSpy.mock.calls;
      for (const call of allCalls) {
        const output = call[0];
        if (typeof output === "string") {
          try {
            const parsed = JSON.parse(output);
            expect(parsed).not.toHaveProperty("async");
          } catch {
            // Not JSON, skip
          }
        }
      }
    } finally {
      // Restore stdin
      Object.defineProperty(process, "stdin", {
        value: originalStdin,
        writable: true,
        configurable: true,
      });
    }
  });

  it("should output systemMessage with statistics for valid session", async () => {
    const { main } = await import("./statistics.js");

    // Create mock stdin with a transcript containing user messages
    const transcript = `{"type":"user","message":{"role":"user","content":"Hello"}}
{"type":"assistant","message":{"role":"assistant","content":"Hi!"}}`;

    // Mock stdin to provide transcript data as Buffer chunks
    const { Readable } = await import("stream");
    const mockStdin = new Readable({
      read() {
        this.push(Buffer.from(transcript));
        this.push(null); // Signal end of stream
      },
    });

    originalStdin = process.stdin;
    Object.defineProperty(process, "stdin", {
      value: mockStdin,
      writable: true,
      configurable: true,
    });

    try {
      await main();

      // Verify that systemMessage was output with Session Statistics
      const allCalls = consoleLogSpy.mock.calls;
      let foundSystemMessage = false;

      for (const call of allCalls) {
        const output = call[0];
        if (typeof output === "string") {
          try {
            const parsed = JSON.parse(output);
            if (parsed.systemMessage) {
              foundSystemMessage = true;
              expect(parsed.systemMessage).toContain("Session Statistics");
            }
          } catch {
            // Not JSON, skip
          }
        }
      }

      expect(foundSystemMessage).toBe(true);
    } finally {
      Object.defineProperty(process, "stdin", {
        value: originalStdin,
        writable: true,
        configurable: true,
      });
    }
  });
});
