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
    mockNewSkillsetFlow.mockClear();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    if (testHomeDir) {
      await fs.rm(testHomeDir, { recursive: true, force: true });
    }
  });

  it("creates a Git-backed skillset from the interactive flow", async () => {
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
    const noriJson = JSON.parse(
      await fs.readFile(path.join(destDir, "nori.json"), "utf-8"),
    );
    expect(noriJson).toEqual({
      name: "my-new-skillset",
      version: "1.0.0",
      type: "skillset",
    });
    expect(result.success).toBe(true);
    expect(result.message).toContain("my-new-skillset");
    const { stdout } = await execFileAsync(
      "git",
      ["rev-parse", "--is-inside-work-tree"],
      { cwd: destDir },
    );
    expect(stdout.trim()).toBe("true");
    expect(mockOutro).not.toHaveBeenCalled();
    expect(mockExit).not.toHaveBeenCalled();
  });

  it("creates a repository from a positional name without tracking Nori state", async () => {
    const result = await newSkillsetMain({
      skillsetName: "zero-prompt-skillset",
    });
    const destDir = path.join(skillsetsDir, "personal", "zero-prompt-skillset");
    expect(result.success).toBe(true);
    expect(mockNewSkillsetFlow).not.toHaveBeenCalled();
    const { stdout: root } = await execFileAsync(
      "git",
      ["rev-parse", "--show-toplevel"],
      { cwd: destDir },
    );
    expect(path.resolve(root.trim())).toBe(path.resolve(destDir));
    await expect(
      execFileAsync("git", ["rev-parse", "--verify", "HEAD"], {
        cwd: destDir,
      }),
    ).rejects.toBeDefined();
    const { stdout: remotes } = await execFileAsync("git", ["remote"], {
      cwd: destDir,
    });
    expect(remotes.trim()).toBe("");
    const ignoredPaths = [
      ".nori/state.json",
      ".nori-version",
      ".nori-managed",
      "skills/demo/.nori-version",
      "skills/demo/.nori-managed",
      ".nori-config.json",
      ".nori-installed-version",
    ];
    const checkedPaths = [...ignoredPaths, ".gitignore", "nori.json"];
    const { stdout: ignored } = await execFileAsync(
      "git",
      ["check-ignore", "--no-index", "--", ...checkedPaths],
      { cwd: destDir },
    );
    expect(ignored.trim().split("\n")).toEqual(ignoredPaths);
  });

  it("rejects an invalid positional name without creating a skillset", async () => {
    const result = await newSkillsetMain({ skillsetName: "Invalid Name" });

    expect(result).toMatchObject({ success: false, cancelled: false });
    expect(await fs.readdir(skillsetsDir)).toEqual([]);
  });

  it.sequential(
    "removes its newly created directory when Git is unavailable",
    async () => {
      vi.stubEnv("PATH", "");
      await expect(
        newSkillsetMain({ skillsetName: "missing-git" }),
      ).rejects.toThrow(/git.*not installed|git.*path/i);

      await expect(
        fs.access(path.join(skillsetsDir, "personal", "missing-git")),
      ).rejects.toThrow();
    },
  );

  it.sequential(
    "creates an independent repository despite inherited Git routing and templates",
    async () => {
      const redirectedGitDir = path.join(testHomeDir, "redirected.git");
      const templateDir = path.join(testHomeDir, "git-template");
      await fs.mkdir(templateDir);
      await fs.writeFile(
        path.join(templateDir, "config"),
        '[remote "origin"]\n\turl = https://example.invalid/repo.git\n',
      );
      vi.stubEnv("GIT_DIR", redirectedGitDir);
      vi.stubEnv("GIT_TEMPLATE_DIR", templateDir);
      vi.stubEnv("GIT_CONFIG_COUNT", "1");
      vi.stubEnv("GIT_CONFIG_KEY_0", "init.templateDir");
      vi.stubEnv("GIT_CONFIG_VALUE_0", templateDir);

      const result = await newSkillsetMain({
        skillsetName: "independent-repository",
      });
      expect(result.success).toBe(true);
      vi.unstubAllEnvs();

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
      const { stdout: remotes } = await execFileAsync("git", ["remote"], {
        cwd: destDir,
      });
      expect(remotes.trim()).toBe("");
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
    await fs.writeFile(path.join(existingDir, "sentinel.txt"), "keep me");

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
    await expect(
      fs.readFile(path.join(existingDir, "sentinel.txt"), "utf-8"),
    ).resolves.toBe("keep me");
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
