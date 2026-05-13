/**
 * Tests for link-skillset command
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock os.homedir so getNoriSkillsetsDir() resolves to test directory
vi.mock("os", async (importOriginal) => {
  const actual = await importOriginal<typeof os>();
  return {
    ...actual,
    homedir: vi.fn().mockReturnValue(actual.homedir()),
  };
});

import { linkSkillsetMain } from "./linkSkillset.js";

describe("linkSkillsetMain", () => {
  let testHomeDir: string;
  let targetDir: string;

  beforeEach(async () => {
    testHomeDir = await fs.mkdtemp(path.join(os.tmpdir(), "link-test-home-"));
    targetDir = await fs.mkdtemp(path.join(os.tmpdir(), "link-test-target-"));
    vi.mocked(os.homedir).mockReturnValue(testHomeDir);

    // Create profiles directory
    await fs.mkdir(path.join(testHomeDir, ".nori", "profiles"), {
      recursive: true,
    });
  });

  afterEach(async () => {
    await fs.rm(testHomeDir, { recursive: true, force: true });
    await fs.rm(targetDir, { recursive: true, force: true });
  });

  it("should create a symlink from profiles dir to target directory", async () => {
    // Target has a nori.json
    await fs.writeFile(
      path.join(targetDir, "nori.json"),
      JSON.stringify({ name: "my-skillset", version: "1.0.0" }),
    );

    const result = await linkSkillsetMain({
      targetDir,
    });

    expect(result.success).toBe(true);

    // Verify symlink was created
    const linkPath = path.join(testHomeDir, ".nori", "profiles", "my-skillset");
    const stat = await fs.lstat(linkPath);
    expect(stat.isSymbolicLink()).toBe(true);

    // Verify symlink points to the target
    const target = await fs.readlink(linkPath);
    expect(target).toBe(targetDir);
  });

  it("should use --name option to override the skillset name", async () => {
    await fs.writeFile(
      path.join(targetDir, "nori.json"),
      JSON.stringify({ name: "original-name", version: "1.0.0" }),
    );

    const result = await linkSkillsetMain({
      targetDir,
      name: "custom-name",
    });

    expect(result.success).toBe(true);

    const linkPath = path.join(testHomeDir, ".nori", "profiles", "custom-name");
    const stat = await fs.lstat(linkPath);
    expect(stat.isSymbolicLink()).toBe(true);
  });

  it("should derive name from directory basename when no nori.json exists", async () => {
    // Target directory is named meaningfully, no nori.json
    const namedTarget = path.join(os.tmpdir(), "my-dev-skillset-" + Date.now());
    await fs.mkdir(namedTarget, { recursive: true });
    await fs.writeFile(path.join(namedTarget, "AGENTS.md"), "# My Profile\n");

    try {
      const result = await linkSkillsetMain({
        targetDir: namedTarget,
      });

      expect(result.success).toBe(true);

      const linkPath = path.join(
        testHomeDir,
        ".nori",
        "profiles",
        path.basename(namedTarget),
      );
      const stat = await fs.lstat(linkPath);
      expect(stat.isSymbolicLink()).toBe(true);
    } finally {
      await fs.rm(namedTarget, { recursive: true, force: true });
    }
  });

  it("should fail when target directory does not exist", async () => {
    const result = await linkSkillsetMain({
      targetDir: "/nonexistent/path",
    });

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/not found|does not exist/i);
  });

  it("should fail when target is not a directory", async () => {
    const filePath = path.join(targetDir, "not-a-dir.txt");
    await fs.writeFile(filePath, "hello");

    const result = await linkSkillsetMain({
      targetDir: filePath,
    });

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/not a directory/i);
  });

  it("should fail when a skillset with that name already exists", async () => {
    await fs.writeFile(
      path.join(targetDir, "nori.json"),
      JSON.stringify({ name: "existing-skillset", version: "1.0.0" }),
    );

    // Create existing real directory at the same name
    const existingDir = path.join(
      testHomeDir,
      ".nori",
      "profiles",
      "existing-skillset",
    );
    await fs.mkdir(existingDir, { recursive: true });
    await fs.writeFile(
      path.join(existingDir, "nori.json"),
      JSON.stringify({ name: "existing-skillset", version: "1.0.0" }),
    );

    const result = await linkSkillsetMain({
      targetDir,
    });

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/already exists/i);
  });

  it("should support org-scoped names", async () => {
    await fs.writeFile(
      path.join(targetDir, "nori.json"),
      JSON.stringify({ name: "my-skillset", version: "1.0.0" }),
    );

    const result = await linkSkillsetMain({
      targetDir,
      name: "myorg/my-skillset",
    });

    expect(result.success).toBe(true);

    const linkPath = path.join(
      testHomeDir,
      ".nori",
      "profiles",
      "myorg",
      "my-skillset",
    );
    const stat = await fs.lstat(linkPath);
    expect(stat.isSymbolicLink()).toBe(true);
  });

  it("should resolve relative paths to absolute before symlinking", async () => {
    await fs.writeFile(
      path.join(targetDir, "nori.json"),
      JSON.stringify({ name: "relative-test", version: "1.0.0" }),
    );

    const result = await linkSkillsetMain({
      targetDir,
      cwd: os.tmpdir(),
    });

    expect(result.success).toBe(true);

    const linkPath = path.join(
      testHomeDir,
      ".nori",
      "profiles",
      "relative-test",
    );
    const resolvedTarget = await fs.readlink(linkPath);
    expect(path.isAbsolute(resolvedTarget)).toBe(true);
  });
});
