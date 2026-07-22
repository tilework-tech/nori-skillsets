/**
 * Tests for new-skillset command
 * Tests that the command creates a new empty skillset directory with nori.json
 */

import * as fs from "fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { newSkillsetMain } from "./newSkillset.js";

const execFileAsync = promisify(execFile);

// Mock os.homedir so getNoriSkillsetsDir() resolves to the test directory
vi.mock("os", async (importOriginal) => {
  const actual = await importOriginal<typeof os>();
  return {
    ...actual,
    homedir: vi.fn().mockReturnValue(actual.homedir()),
  };
});

// Mock @clack/prompts for output
const mockLogError = vi.fn();
const mockNote = vi.fn();
const mockOutro = vi.fn();
vi.mock("@clack/prompts", () => ({
  log: {
    error: (msg: string) => mockLogError(msg),
  },
  note: (content: string, title: string) => mockNote(content, title),
  outro: (msg: string) => mockOutro(msg),
}));

// Mock process.exit
const mockExit = vi
  .spyOn(process, "exit")
  .mockImplementation(() => undefined as never);

// Mock newSkillsetFlow
const mockNewSkillsetFlow = vi.fn();
vi.mock("@/cli/prompts/flows/newSkillset.js", () => ({
  newSkillsetFlow: () => mockNewSkillsetFlow(),
}));

describe("newSkillsetMain", () => {
  let testHomeDir: string;
  let skillsetsDir: string;

  beforeEach(async () => {
    testHomeDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "new-skillset-test-"),
    );
    vi.mocked(os.homedir).mockReturnValue(testHomeDir);
    skillsetsDir = path.join(testHomeDir, ".nori", "profiles");
    await fs.mkdir(skillsetsDir, { recursive: true });
    mockLogError.mockClear();
    mockNote.mockClear();
    mockOutro.mockClear();
    mockExit.mockClear();
    mockNewSkillsetFlow.mockReset();
  });

  afterEach(async () => {
    if (testHomeDir) {
      await fs.rm(testHomeDir, { recursive: true, force: true });
    }
  });

  it("should create a flat skillset with nori.json", async () => {
    mockNewSkillsetFlow.mockResolvedValueOnce({
      name: "my-new-skillset",
      description: null,
      license: null,
      keywords: null,
      version: null,
      repository: null,
    });

    const result = await newSkillsetMain();

    const destDir = path.join(skillsetsDir, "personal", "my-new-skillset");

    // Verify nori.json exists with correct content
    const noriJson = JSON.parse(
      await fs.readFile(path.join(destDir, "nori.json"), "utf-8"),
    );
    expect(noriJson).toEqual({
      name: "my-new-skillset",
      version: "1.0.0",
      type: "skillset",
    });

    // Verify return status contains skillset name
    expect(result.success).toBe(true);
    expect(result.message).toContain("my-new-skillset");
    expect(mockOutro).not.toHaveBeenCalled();
    expect(mockExit).not.toHaveBeenCalled();

    const { stdout } = await execFileAsync(
      "git",
      ["rev-parse", "--is-inside-work-tree"],
      { cwd: destDir },
    );
    expect(stdout.trim()).toBe("true");
  });

  it("creates a named skillset without running the metadata wizard", async () => {
    mockNewSkillsetFlow.mockRejectedValueOnce(
      new Error("metadata wizard must not run"),
    );

    const result = await newSkillsetMain({
      skillsetName: "zero-prompt-skillset",
    });

    const destDir = path.join(skillsetsDir, "personal", "zero-prompt-skillset");
    const noriJson = JSON.parse(
      await fs.readFile(path.join(destDir, "nori.json"), "utf-8"),
    );
    expect(noriJson).toEqual({
      name: "zero-prompt-skillset",
      version: "1.0.0",
      type: "skillset",
    });
    expect(result.success).toBe(true);

    const { stdout } = await execFileAsync(
      "git",
      ["rev-parse", "--show-toplevel"],
      { cwd: destDir },
    );
    expect(path.resolve(stdout.trim())).toBe(path.resolve(destDir));
  });

  it("keeps Nori-local state out of Git status", async () => {
    const result = await newSkillsetMain({ skillsetName: "ignored-state" });
    expect(result.success).toBe(true);

    const destDir = path.join(skillsetsDir, "personal", "ignored-state");
    await fs.mkdir(path.join(destDir, ".nori"));
    await fs.writeFile(path.join(destDir, ".nori", "state.json"), "{}");
    await fs.writeFile(path.join(destDir, ".nori-version"), "{}");
    await fs.writeFile(path.join(destDir, ".nori-managed"), "ignored-state");
    await fs.mkdir(path.join(destDir, "skills", "demo"), { recursive: true });
    await fs.writeFile(
      path.join(destDir, "skills", "demo", ".nori-version"),
      "{}",
    );
    await fs.writeFile(
      path.join(destDir, "skills", "demo", ".nori-managed"),
      "ignored-state",
    );
    await fs.writeFile(path.join(destDir, ".nori-config.json"), "{}");
    await fs.writeFile(path.join(destDir, ".nori-installed-version"), "1");

    const { stdout } = await execFileAsync(
      "git",
      ["status", "--short", "--untracked-files=all"],
      { cwd: destDir },
    );
    expect(stdout.trim().split("\n").sort()).toEqual([
      "?? .gitignore",
      "?? nori.json",
    ]);
  });

  it("rejects an invalid positional name without creating a skillset", async () => {
    const result = await newSkillsetMain({ skillsetName: "Invalid Name" });

    expect(result).toMatchObject({ success: false, cancelled: false });
    expect(await fs.readdir(skillsetsDir)).toEqual([]);
  });

  it("does not modify or remove an existing positional destination", async () => {
    const existingDir = path.join(skillsetsDir, "personal", "protected");
    await fs.mkdir(existingDir, { recursive: true });
    await fs.writeFile(path.join(existingDir, "sentinel.txt"), "keep me");
    mockNewSkillsetFlow.mockRejectedValueOnce(
      new Error("metadata wizard must not run"),
    );

    const result = await newSkillsetMain({ skillsetName: "protected" });

    expect(result).toMatchObject({ success: false, cancelled: false });
    await expect(
      fs.readFile(path.join(existingDir, "sentinel.txt"), "utf-8"),
    ).resolves.toBe("keep me");
  });

  it.sequential(
    "removes its newly created directory when Git is unavailable",
    async () => {
      const originalPath = process.env.PATH;
      process.env.PATH = "";
      try {
        await expect(
          newSkillsetMain({ skillsetName: "missing-git" }),
        ).rejects.toThrow(/git.*not installed|git.*path/i);
      } finally {
        process.env.PATH = originalPath;
      }

      await expect(
        fs.access(path.join(skillsetsDir, "personal", "missing-git")),
      ).rejects.toThrow();
    },
  );

  it.sequential(
    "creates an independent repository despite inherited Git routing variables",
    async () => {
      const redirectedGitDir = path.join(testHomeDir, "redirected.git");
      const originalGitDir = process.env.GIT_DIR;
      process.env.GIT_DIR = redirectedGitDir;
      try {
        const result = await newSkillsetMain({
          skillsetName: "independent-repository",
        });
        expect(result.success).toBe(true);
      } finally {
        if (originalGitDir == null) {
          delete process.env.GIT_DIR;
        } else {
          process.env.GIT_DIR = originalGitDir;
        }
      }

      const destDir = path.join(
        skillsetsDir,
        "personal",
        "independent-repository",
      );
      const { stdout } = await execFileAsync(
        "git",
        ["rev-parse", "--show-toplevel"],
        { cwd: destDir },
      );
      expect(path.resolve(stdout.trim())).toBe(path.resolve(destDir));
      await expect(fs.access(redirectedGitDir)).rejects.toThrow();
    },
  );

  it("should create a namespaced skillset with parent directories", async () => {
    mockNewSkillsetFlow.mockResolvedValueOnce({
      name: "myorg/custom-profile",
      description: null,
      license: null,
      keywords: null,
      version: null,
      repository: null,
    });

    await newSkillsetMain();

    const destDir = path.join(skillsetsDir, "myorg", "custom-profile");

    // Verify nori.json uses basename as name
    const noriJson = JSON.parse(
      await fs.readFile(path.join(destDir, "nori.json"), "utf-8"),
    );
    expect(noriJson).toEqual({
      name: "custom-profile",
      version: "1.0.0",
      type: "skillset",
    });

    expect(mockExit).not.toHaveBeenCalled();
  });

  it("creates a bare name under the configured default org", async () => {
    await fs.writeFile(
      path.join(testHomeDir, ".nori-config.json"),
      JSON.stringify({ defaultOrg: "myorg" }),
    );

    mockNewSkillsetFlow.mockResolvedValueOnce({
      name: "amol",
      description: null,
      license: null,
      keywords: null,
      version: null,
      repository: null,
    });

    const result = await newSkillsetMain();

    const destDir = path.join(skillsetsDir, "myorg", "amol");
    const noriJson = JSON.parse(
      await fs.readFile(path.join(destDir, "nori.json"), "utf-8"),
    );
    expect(noriJson.name).toBe("amol");
    expect(result.success).toBe(true);
    expect(mockExit).not.toHaveBeenCalled();
  });

  it("should error when skillset already exists", async () => {
    // Create a directory that already exists in the personal bucket
    const existingDir = path.join(
      skillsetsDir,
      "personal",
      "existing-skillset",
    );
    await fs.mkdir(existingDir, { recursive: true });

    mockNewSkillsetFlow.mockResolvedValueOnce({
      name: "existing-skillset",
      description: null,
      license: null,
      keywords: null,
      version: null,
      repository: null,
    });

    const result = await newSkillsetMain();

    expect(mockLogError).toHaveBeenCalledWith(
      expect.stringContaining("existing-skillset"),
    );
    expect(mockLogError).toHaveBeenCalledWith(
      expect.stringContaining("already exists"),
    );
    expect(result.success).toBe(false);
  });

  it("should print instructions for switching and editing after creation", async () => {
    mockNewSkillsetFlow.mockResolvedValueOnce({
      name: "my-skillset",
      description: null,
      license: null,
      keywords: null,
      version: null,
      repository: null,
    });

    await newSkillsetMain();

    // Should show note with next steps containing switch and edit instructions
    expect(mockNote).toHaveBeenCalledWith(
      expect.stringContaining("switch personal/my-skillset"),
      "Next Steps",
    );
    expect(mockNote).toHaveBeenCalledWith(
      expect.stringContaining("~/.nori/profiles/personal/my-skillset"),
      "Next Steps",
    );
  });

  it("should write all metadata fields to nori.json when provided", async () => {
    mockNewSkillsetFlow.mockResolvedValueOnce({
      name: "full-metadata",
      description: "A skillset with full metadata",
      license: "Apache-2.0",
      keywords: ["testing", "automation"],
      version: "2.1.0",
      repository: "https://github.com/user/repo",
    });

    await newSkillsetMain();

    const destDir = path.join(skillsetsDir, "personal", "full-metadata");
    const noriJson = JSON.parse(
      await fs.readFile(path.join(destDir, "nori.json"), "utf-8"),
    );

    expect(noriJson).toEqual({
      name: "full-metadata",
      version: "2.1.0",
      type: "skillset",
      description: "A skillset with full metadata",
      license: "Apache-2.0",
      keywords: ["automation", "testing"],
      repository: "https://github.com/user/repo",
    });
  });

  it("should use default version 1.0.0 when version is null", async () => {
    mockNewSkillsetFlow.mockResolvedValueOnce({
      name: "default-version",
      description: "Test",
      license: null,
      keywords: null,
      version: null,
      repository: null,
    });

    await newSkillsetMain();

    const destDir = path.join(skillsetsDir, "personal", "default-version");
    const noriJson = JSON.parse(
      await fs.readFile(path.join(destDir, "nori.json"), "utf-8"),
    );

    expect(noriJson.version).toBe("1.0.0");
  });

  it("should omit optional fields from nori.json when they are null", async () => {
    mockNewSkillsetFlow.mockResolvedValueOnce({
      name: "minimal-metadata",
      description: null,
      license: null,
      keywords: null,
      version: "1.5.0",
      repository: null,
    });

    await newSkillsetMain();

    const destDir = path.join(skillsetsDir, "personal", "minimal-metadata");
    const noriJson = JSON.parse(
      await fs.readFile(path.join(destDir, "nori.json"), "utf-8"),
    );

    expect(noriJson).toEqual({
      name: "minimal-metadata",
      version: "1.5.0",
      type: "skillset",
    });
    expect(noriJson.description).toBeUndefined();
    expect(noriJson.license).toBeUndefined();
    expect(noriJson.keywords).toBeUndefined();
    expect(noriJson.repository).toBeUndefined();
  });

  it("should handle flow cancellation gracefully", async () => {
    mockNewSkillsetFlow.mockResolvedValueOnce(null);

    await newSkillsetMain();

    // Should not create any directory
    const files = await fs.readdir(skillsetsDir);
    expect(files).toEqual([]);

    // Should not print outro message
    expect(mockOutro).not.toHaveBeenCalled();
  });

  it("should write repository as a string", async () => {
    mockNewSkillsetFlow.mockResolvedValueOnce({
      name: "repo-test",
      description: null,
      license: null,
      keywords: null,
      version: null,
      repository: "https://github.com/example/repo",
    });

    await newSkillsetMain();

    const destDir = path.join(skillsetsDir, "personal", "repo-test");
    const noriJson = JSON.parse(
      await fs.readFile(path.join(destDir, "nori.json"), "utf-8"),
    );

    expect(noriJson.repository).toBe("https://github.com/example/repo");
  });
});
