/**
 * Tests for unlink-skillset command
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Track mock homedir
let mockHomedir = "";

// Mock os.homedir
vi.mock("node:os", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = (await importOriginal()) as typeof import("os");
  return {
    ...actual,
    homedir: () => mockHomedir,
  };
});

// Mock the config module
vi.mock("@/cli/config.js", async () => {
  return {
    loadConfig: vi.fn(),
    getActiveSkillset: vi.fn(),
    updateConfig: vi.fn(),
  };
});

import { loadConfig, getActiveSkillset, updateConfig } from "@/cli/config.js";

import { unlinkSkillsetMain } from "./unlinkSkillset.js";

describe("unlinkSkillsetMain", () => {
  let testHomeDir: string;
  let targetDir: string;

  beforeEach(async () => {
    vi.resetAllMocks();
    testHomeDir = await fs.mkdtemp(path.join(os.tmpdir(), "unlink-test-home-"));
    targetDir = await fs.mkdtemp(path.join(os.tmpdir(), "unlink-test-target-"));
    mockHomedir = testHomeDir;

    // Create profiles directory
    await fs.mkdir(path.join(testHomeDir, ".nori", "profiles"), {
      recursive: true,
    });
  });

  afterEach(async () => {
    await fs.rm(testHomeDir, { recursive: true, force: true });
    await fs.rm(targetDir, { recursive: true, force: true });
  });

  it("should remove a symlinked skillset", async () => {
    const linkPath = path.join(testHomeDir, ".nori", "profiles", "my-skillset");
    await fs.symlink(targetDir, linkPath);

    const result = await unlinkSkillsetMain({ name: "my-skillset" });

    expect(result.success).toBe(true);
    await expect(fs.lstat(linkPath)).rejects.toThrow();
  });

  it("should refuse to remove a real directory (not a symlink)", async () => {
    const realDir = path.join(
      testHomeDir,
      ".nori",
      "profiles",
      "real-skillset",
    );
    await fs.mkdir(realDir, { recursive: true });
    await fs.writeFile(
      path.join(realDir, "nori.json"),
      JSON.stringify({ name: "real-skillset", version: "1.0.0" }),
    );

    const result = await unlinkSkillsetMain({ name: "real-skillset" });

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/not a linked skillset/i);

    // Verify directory was NOT removed
    const stat = await fs.stat(realDir);
    expect(stat.isDirectory()).toBe(true);
  });

  it("should fail when skillset does not exist", async () => {
    const result = await unlinkSkillsetMain({ name: "nonexistent" });

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/not found/i);
  });

  it("should clear active skillset config when unlinking the active skillset", async () => {
    const linkPath = path.join(
      testHomeDir,
      ".nori",
      "profiles",
      "active-skillset",
    );
    await fs.symlink(targetDir, linkPath);

    vi.mocked(loadConfig).mockResolvedValue({
      installDir: testHomeDir,
      activeSkillset: "active-skillset",
    });
    vi.mocked(getActiveSkillset).mockReturnValue("active-skillset");

    const result = await unlinkSkillsetMain({ name: "active-skillset" });

    expect(result.success).toBe(true);
    expect(updateConfig).toHaveBeenCalledWith({ activeSkillset: null });
  });

  it("should clear active skillset when unlinking a bucketed skillset by its bare name", async () => {
    // The link lives in the personal bucket and the config stores the
    // canonical namespaced identity; unlink is invoked with the bare name.
    const linkPath = path.join(
      testHomeDir,
      ".nori",
      "profiles",
      "personal",
      "active-skillset",
    );
    await fs.mkdir(path.dirname(linkPath), { recursive: true });
    await fs.symlink(targetDir, linkPath);

    vi.mocked(loadConfig).mockResolvedValue({
      installDir: testHomeDir,
      activeSkillset: "personal/active-skillset",
    });
    vi.mocked(getActiveSkillset).mockReturnValue("personal/active-skillset");

    const result = await unlinkSkillsetMain({ name: "active-skillset" });

    expect(result.success).toBe(true);
    expect(updateConfig).toHaveBeenCalledWith({ activeSkillset: null });
  });

  it("should not clear active skillset when unlinking a non-active skillset", async () => {
    const linkPath = path.join(
      testHomeDir,
      ".nori",
      "profiles",
      "other-skillset",
    );
    await fs.symlink(targetDir, linkPath);

    vi.mocked(loadConfig).mockResolvedValue({
      installDir: testHomeDir,
      activeSkillset: "active-skillset",
    });
    vi.mocked(getActiveSkillset).mockReturnValue("active-skillset");

    const result = await unlinkSkillsetMain({ name: "other-skillset" });

    expect(result.success).toBe(true);
    expect(updateConfig).not.toHaveBeenCalled();
  });

  it("should support org-scoped names", async () => {
    const orgDir = path.join(testHomeDir, ".nori", "profiles", "myorg");
    await fs.mkdir(orgDir, { recursive: true });
    await fs.symlink(targetDir, path.join(orgDir, "my-skillset"));

    const result = await unlinkSkillsetMain({ name: "myorg/my-skillset" });

    expect(result.success).toBe(true);
    await expect(fs.lstat(path.join(orgDir, "my-skillset"))).rejects.toThrow();
  });
});
