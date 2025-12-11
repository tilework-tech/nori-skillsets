/**
 * Tests for CursorLoaderRegistry
 */

import { describe, test, expect, beforeEach, afterEach } from "vitest";

import { CursorLoaderRegistry } from "@/cli/features/cursor-agent/loaderRegistry.js";

describe("CursorLoaderRegistry", () => {
  beforeEach(() => {
    CursorLoaderRegistry.resetInstance();
  });

  afterEach(() => {
    CursorLoaderRegistry.resetInstance();
  });

  describe("getInstance", () => {
    test("returns singleton instance", () => {
      const instance1 = CursorLoaderRegistry.getInstance();
      const instance2 = CursorLoaderRegistry.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe("getAll", () => {
    test("returns array of loaders", () => {
      const registry = CursorLoaderRegistry.getInstance();
      const loaders = registry.getAll();

      expect(Array.isArray(loaders)).toBe(true);
      expect(loaders.length).toBeGreaterThan(0);
    });

    test("includes profiles loader", () => {
      const registry = CursorLoaderRegistry.getInstance();
      const loaders = registry.getAll();
      const names = loaders.map((l) => l.name);

      expect(names).toContain("profiles");
    });

    test("includes hooks loader", () => {
      const registry = CursorLoaderRegistry.getInstance();
      const loaders = registry.getAll();
      const names = loaders.map((l) => l.name);

      expect(names).toContain("hooks");
    });

    test("includes slashcommands loader", () => {
      const registry = CursorLoaderRegistry.getInstance();
      const loaders = registry.getAll();
      const names = loaders.map((l) => l.name);

      expect(names).toContain("slashcommands");
    });
  });

  describe("getAllReversed", () => {
    test("returns loaders in reverse order", () => {
      const registry = CursorLoaderRegistry.getInstance();
      const loaders = registry.getAll();
      const reversed = registry.getAllReversed();

      expect(reversed.length).toBe(loaders.length);
      expect(reversed[0]).toBe(loaders[loaders.length - 1]);
      expect(reversed[reversed.length - 1]).toBe(loaders[0]);
    });
  });
});
