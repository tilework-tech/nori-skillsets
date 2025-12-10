/**
 * Tests for CursorLoaderRegistry
 * Verifies singleton pattern, loader registration, and ordering
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import type { CursorLoaderRegistry as CursorLoaderRegistryType } from "./cursorLoaderRegistry.js";

// We need to reset the singleton between tests
let CursorLoaderRegistry: typeof CursorLoaderRegistryType;

describe("CursorLoaderRegistry", () => {
  beforeEach(async () => {
    // Reset module cache to get fresh singleton
    vi.resetModules();
    const module = await import("./cursorLoaderRegistry.js");
    CursorLoaderRegistry = module.CursorLoaderRegistry;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("getInstance", () => {
    it("should return a singleton instance", () => {
      const instance1 = CursorLoaderRegistry.getInstance();
      const instance2 = CursorLoaderRegistry.getInstance();

      expect(instance1).toBe(instance2);
    });
  });

  describe("getAll", () => {
    it("should return all registered loaders", () => {
      const registry = CursorLoaderRegistry.getInstance();
      const loaders = registry.getAll();

      expect(loaders).toBeDefined();
      expect(Array.isArray(loaders)).toBe(true);
      expect(loaders.length).toBeGreaterThan(0);
    });

    it("should include cursorProfilesLoader", () => {
      const registry = CursorLoaderRegistry.getInstance();
      const loaders = registry.getAll();

      const hasProfilesLoader = loaders.some(
        (loader) => loader.name === "cursor-profiles",
      );
      expect(hasProfilesLoader).toBe(true);
    });

    it("should include cursorSlashCommandsLoader", () => {
      const registry = CursorLoaderRegistry.getInstance();
      const loaders = registry.getAll();

      const hasSlashCommandsLoader = loaders.some(
        (loader) => loader.name === "cursor-slashcommands",
      );
      expect(hasSlashCommandsLoader).toBe(true);
    });

    it("should return loaders with required interface properties", () => {
      const registry = CursorLoaderRegistry.getInstance();
      const loaders = registry.getAll();

      for (const loader of loaders) {
        expect(loader).toHaveProperty("name");
        expect(loader).toHaveProperty("description");
        expect(loader).toHaveProperty("run");
        expect(loader).toHaveProperty("uninstall");
        expect(typeof loader.name).toBe("string");
        expect(typeof loader.description).toBe("string");
        expect(typeof loader.run).toBe("function");
        expect(typeof loader.uninstall).toBe("function");
      }
    });
  });

  describe("getAllReversed", () => {
    it("should return loaders in reverse order", () => {
      const registry = CursorLoaderRegistry.getInstance();
      const loaders = registry.getAll();
      const reversedLoaders = registry.getAllReversed();

      expect(reversedLoaders.length).toBe(loaders.length);

      // Verify order is reversed
      for (let i = 0; i < loaders.length; i++) {
        expect(reversedLoaders[i]).toBe(loaders[loaders.length - 1 - i]);
      }
    });
  });
});
