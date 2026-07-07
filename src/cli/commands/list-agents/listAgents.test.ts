/**
 * Tests for the list-agents command
 * Verifies it emits the registered agent identifiers as a comma-separated
 * line, mirroring exactly what the registry accepts (the validity oracle).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

import { AgentRegistry } from "@/cli/features/agentRegistry.js";

import { getRegisteredAgents, listAgentsMain } from "./listAgents.js";

// Mock process.stdout.write for raw output
const mockStdoutWrite = vi
  .spyOn(process.stdout, "write")
  .mockImplementation(() => true);

describe("getRegisteredAgents", () => {
  it("returns exactly the registry's agent list", () => {
    expect(getRegisteredAgents()).toEqual(AgentRegistry.getInstance().list());
  });

  it("includes the first-class supported agents", () => {
    const agents = getRegisteredAgents();
    expect(agents).toContain("claude-code");
    expect(agents).toContain("codex");
    expect(agents).toContain("gemini-cli");
  });

  it("does not include unknown agents", () => {
    expect(getRegisteredAgents()).not.toContain("grok-build");
  });
});

describe("listAgentsMain", () => {
  beforeEach(() => {
    mockStdoutWrite.mockClear();
  });

  it("writes the agents as a single comma-separated line with a trailing newline", () => {
    listAgentsMain();

    expect(mockStdoutWrite).toHaveBeenCalledTimes(1);
    const output = mockStdoutWrite.mock.calls[0]?.[0] as string;
    expect(output).toBe(getRegisteredAgents().join(",") + "\n");
    expect(output.endsWith("\n")).toBe(true);
    expect(output).not.toContain("\n" + "\n");
  });

  it("emits ids that round-trip through the registry (faithful oracle)", () => {
    listAgentsMain();

    const line = (mockStdoutWrite.mock.calls[0]?.[0] as string).trim();
    const registry = AgentRegistry.getInstance();
    for (const id of line.split(",")) {
      // Each emitted id must resolve — this is what switch/config rely on.
      expect(() => registry.get({ name: id })).not.toThrow();
    }
  });
});
