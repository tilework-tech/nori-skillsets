/**
 * Tests for AgentRegistry
 * Tests real behavior: selecting agents by name, listing available agents
 */

import { describe, test, expect, beforeEach, afterEach } from "vitest";

import { AgentRegistry } from "@/cli/features/agentRegistry.js";

describe("AgentRegistry", () => {
  // Reset singleton between tests
  beforeEach(() => {
    AgentRegistry.resetInstance();
  });

  afterEach(() => {
    AgentRegistry.resetInstance();
  });

  describe("getInstance", () => {
    test("returns singleton instance", () => {
      const instance1 = AgentRegistry.getInstance();
      const instance2 = AgentRegistry.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe("get", () => {
    test("returns claude-code agent when requested", () => {
      const registry = AgentRegistry.getInstance();
      const agent = registry.get({ name: "claude-code" });

      expect(agent.name).toBe("claude-code");
      expect(agent.displayName).toBe("Claude Code");
    });

    test("throws error with helpful message for unknown agent", () => {
      const registry = AgentRegistry.getInstance();

      expect(() => registry.get({ name: "unknown-agent" })).toThrow(
        /Unknown agent 'unknown-agent'\. Available agents: claude-code/,
      );
    });

    test("throws error for empty agent name", () => {
      const registry = AgentRegistry.getInstance();

      expect(() => registry.get({ name: "" })).toThrow(/Unknown agent/);
    });
  });

  describe("list", () => {
    test("returns array of agent names", () => {
      const registry = AgentRegistry.getInstance();
      const agents = registry.list();

      expect(agents).toContain("claude-code");
      expect(agents.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("agent interface", () => {
    test("claude-code agent provides LoaderRegistry", () => {
      const registry = AgentRegistry.getInstance();
      const agent = registry.get({ name: "claude-code" });
      const loaderRegistry = agent.getLoaderRegistry();

      // Verify it has the expected methods
      expect(loaderRegistry.getAll).toBeDefined();
      expect(loaderRegistry.getAllReversed).toBeDefined();

      // Verify it returns loaders
      const loaders = loaderRegistry.getAll();
      expect(loaders.length).toBeGreaterThan(0);
    });

    test("claude-code agent provides correct env paths", () => {
      const registry = AgentRegistry.getInstance();
      const agent = registry.get({ name: "claude-code" });
      const paths = agent.getEnvPaths({ installDir: "/test/install" });

      expect(paths.profilesDir).toBe("/test/install/.claude/profiles");
      expect(paths.instructionsFile).toBe("/test/install/.claude/CLAUDE.md");
    });
  });
});
