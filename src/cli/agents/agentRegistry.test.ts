/**
 * Tests for AgentRegistry
 *
 * Verifies the agent registry correctly maps agent names to their configurations
 * and provides helpful errors for unknown agents.
 */

import { describe, it, expect } from "vitest";

import { AgentRegistry, type AgentConfig } from "@/cli/agents/agentRegistry.js";

describe("AgentRegistry", () => {
  describe("getAgent", () => {
    it("should return claude-code agent config when requested", () => {
      const registry = AgentRegistry.getInstance();
      const agent = registry.getAgent({ name: "claude-code" });

      expect(agent).toBeDefined();
      expect(agent.name).toBe("claude-code");
      expect(agent.description).toBeDefined();
      expect(typeof agent.description).toBe("string");
    });

    it("should return a LoaderRegistry from claude-code agent", () => {
      const registry = AgentRegistry.getInstance();
      const agent = registry.getAgent({ name: "claude-code" });
      const loaderRegistry = agent.getLoaderRegistry();

      expect(loaderRegistry).toBeDefined();
      expect(loaderRegistry.getAll).toBeDefined();
      expect(typeof loaderRegistry.getAll).toBe("function");

      // Verify it returns actual loaders
      const loaders = loaderRegistry.getAll();
      expect(Array.isArray(loaders)).toBe(true);
      expect(loaders.length).toBeGreaterThan(0);
    });

    it("should return a source profiles directory from claude-code agent", () => {
      const registry = AgentRegistry.getInstance();
      const agent = registry.getAgent({ name: "claude-code" });
      const profilesDir = agent.getSourceProfilesDir();

      expect(profilesDir).toBeDefined();
      expect(typeof profilesDir).toBe("string");
      expect(profilesDir).toContain("profiles");
      expect(profilesDir).toContain("config");
    });

    it("should throw error with list of valid agents for unknown agent", () => {
      const registry = AgentRegistry.getInstance();

      expect(() => registry.getAgent({ name: "unknown-agent" })).toThrow();

      try {
        registry.getAgent({ name: "unknown-agent" });
      } catch (error: any) {
        expect(error.message).toContain("unknown-agent");
        expect(error.message).toContain("claude-code");
      }
    });
  });

  describe("getAllAgents", () => {
    it("should return array containing claude-code", () => {
      const registry = AgentRegistry.getInstance();
      const agents = registry.getAllAgents();

      expect(Array.isArray(agents)).toBe(true);
      expect(agents.length).toBeGreaterThan(0);

      const agentNames = agents.map((a: AgentConfig) => a.name);
      expect(agentNames).toContain("claude-code");
    });
  });

  describe("getDefaultAgent", () => {
    it("should return claude-code as the default agent", () => {
      const registry = AgentRegistry.getInstance();
      const defaultAgent = registry.getDefaultAgent();

      expect(defaultAgent).toBeDefined();
      expect(defaultAgent.name).toBe("claude-code");
    });
  });

  describe("singleton behavior", () => {
    it("should return the same instance", () => {
      const registry1 = AgentRegistry.getInstance();
      const registry2 = AgentRegistry.getInstance();

      expect(registry1).toBe(registry2);
    });
  });
});
