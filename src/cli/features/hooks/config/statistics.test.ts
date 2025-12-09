import { describe, it, expect } from "vitest";

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
