/**
 * Tests for fork-skillset command
 * Tests that the command correctly copies an existing skillset to a new name
 */

import * as fs from "fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { forkSkillsetMain } from "./forkSkillset.js";

const execFileAsync = promisify(execFile);

const runGit = async (args: {
  cwd: string;
  command: Array<string>;
}): Promise<string> => {
  const { stdout } = await execFileAsync("git", args.command, {
    cwd: args.cwd,
  });
  return stdout.trim();
};

const writeFixtureTree = async (args: {
  root: string;
  files: Record<string, string>;
}): Promise<void> => {
  await Promise.all(
    Object.entries(args.files).map(async ([relativePath, content]) => {
      const filePath = path.join(args.root, relativePath);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, content);
    }),
  );
};

const initializeCommittedRepository = async (args: {
  dir: string;
  forceAdd?: boolean | null;
}): Promise<void> => {
  await runGit({ cwd: args.dir, command: ["init", "--template="] });
  await runGit({
    cwd: args.dir,
    command: ["config", "user.email", "test@example.com"],
  });
  await runGit({
    cwd: args.dir,
    command: ["config", "user.name", "Feature Test"],
  });
  await runGit({
    cwd: args.dir,
    command: ["add", "--all", ...(args.forceAdd === true ? ["--force"] : [])],
  });
  await runGit({
    cwd: args.dir,
    command: ["commit", "--quiet", "-m", "initial"],
  });
};

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

describe("forkSkillsetMain", () => {
  let testHomeDir: string;
  let skillsetsDir: string;

  beforeEach(async () => {
    testHomeDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "fork-skillset-test-"),
    );
    vi.mocked(os.homedir).mockReturnValue(testHomeDir);
    skillsetsDir = path.join(testHomeDir, ".nori", "profiles");
    await fs.mkdir(skillsetsDir, { recursive: true });
    mockLogError.mockClear();
    mockNote.mockClear();
    mockOutro.mockClear();
    mockExit.mockClear();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    if (testHomeDir) {
      await fs.rm(testHomeDir, { recursive: true, force: true });
    }
  });

  it("copies a linked source without its repository, Registrar, cache, or generated state", async () => {
    const sourceDir = path.join(testHomeDir, "linked-source");
    await writeFixtureTree({
      root: sourceDir,
      files: {
        "nori.json": JSON.stringify({
          name: "linked-source",
          version: "1.2.3",
          type: "skillset",
          repository: "https://example.invalid/authored-package",
          registryURL: "https://registry.example.invalid",
        }),
        "skills/demo/SKILL.md": "# Demo\n",
        "skills/demo/.nori-version": "nested registry\n",
        "README.md": "# Authored docs\n",
        ".github/workflows/ci.yml": "name: authored\n",
        ".nori-version": "registry\n",
        ".nori/state.json": "{}\n",
        ".nori-managed": "source\n",
        ".nori-config.json": "{}\n",
        ".nori-installed-version": "1.2.3\n",
        "node_modules/dependency/index.js": "module.exports = true;\n",
        ".claude/.nori-managed": "linked-source\n",
        ".claude/settings.json": "{}\n",
        ".mcp.json": "{}\n",
      },
    });
    await initializeCommittedRepository({ dir: sourceDir, forceAdd: true });
    await writeFixtureTree({
      root: sourceDir,
      files: {
        ".GIT/authored.txt": "case-sensitive authored content\n",
      },
    });
    await runGit({
      cwd: sourceDir,
      command: [
        "remote",
        "add",
        "origin",
        "https://example.invalid/upstream.git",
      ],
    });
    const sourceHead = await runGit({
      cwd: sourceDir,
      command: ["rev-parse", "HEAD"],
    });
    const sourceStatus = await runGit({
      cwd: sourceDir,
      command: ["status", "--porcelain"],
    });

    const personalDir = path.join(skillsetsDir, "personal");
    await fs.mkdir(personalDir, { recursive: true });
    await fs.symlink(sourceDir, path.join(personalDir, "linked-source"), "dir");

    const result = await forkSkillsetMain({
      baseSkillset: "linked-source",
      newSkillset: "independent-fork",
    });

    const destDir = path.join(personalDir, "independent-fork");
    expect(result.success).toBe(true);
    expect((await fs.lstat(destDir)).isSymbolicLink()).toBe(false);
    expect(
      await fs.readFile(
        path.join(destDir, "skills", "demo", "SKILL.md"),
        "utf8",
      ),
    ).toBe("# Demo\n");
    expect(await fs.readFile(path.join(destDir, "README.md"), "utf8")).toBe(
      "# Authored docs\n",
    );
    expect(
      await fs.readFile(path.join(destDir, ".GIT", "authored.txt"), "utf8"),
    ).toBe("case-sensitive authored content\n");
    expect(
      await fs.readFile(
        path.join(destDir, ".github", "workflows", "ci.yml"),
        "utf8",
      ),
    ).toBe("name: authored\n");

    const manifest = JSON.parse(
      await fs.readFile(path.join(destDir, "nori.json"), "utf8"),
    );
    expect(manifest).toMatchObject({
      name: "independent-fork",
      version: "1.2.3",
      type: "skillset",
      repository: "https://example.invalid/authored-package",
    });
    expect(manifest.registryURL).toBeUndefined();

    for (const excludedPath of [
      ".nori-version",
      ".nori",
      ".nori-managed",
      ".nori-config.json",
      ".nori-installed-version",
      "node_modules",
      ".claude",
      ".mcp.json",
      path.join("skills", "demo", ".nori-version"),
    ]) {
      await expect(
        fs.access(path.join(destDir, excludedPath)),
      ).rejects.toThrow();
    }

    expect(
      await runGit({ cwd: sourceDir, command: ["rev-parse", "HEAD"] }),
    ).toBe(sourceHead);
    expect(
      await runGit({ cwd: sourceDir, command: ["status", "--porcelain"] }),
    ).toBe(sourceStatus);
    const sourceManifest = JSON.parse(
      await fs.readFile(path.join(sourceDir, "nori.json"), "utf8"),
    );
    expect(sourceManifest.name).toBe("linked-source");
  });

  it("initializes a fresh repository without history or a remote", async () => {
    const sourceDir = path.join(skillsetsDir, "personal", "versioned-source");
    await writeFixtureTree({
      root: sourceDir,
      files: {
        "nori.json": JSON.stringify({
          name: "versioned-source",
          version: "1.0.0",
          type: "skillset",
        }),
        ".gitignore": "secrets/\n",
      },
    });
    await initializeCommittedRepository({ dir: sourceDir });
    await runGit({
      cwd: sourceDir,
      command: [
        "remote",
        "add",
        "origin",
        "https://example.invalid/upstream.git",
      ],
    });

    const result = await forkSkillsetMain({
      baseSkillset: "versioned-source",
      newSkillset: "fresh-history",
    });

    const destDir = path.join(skillsetsDir, "personal", "fresh-history");
    expect(result.success).toBe(true);
    expect(
      path.resolve(
        await runGit({
          cwd: destDir,
          command: ["rev-parse", "--show-toplevel"],
        }),
      ),
    ).toBe(path.resolve(destDir));
    await expect(
      runGit({ cwd: destDir, command: ["rev-parse", "--verify", "HEAD"] }),
    ).rejects.toBeDefined();
    expect(await runGit({ cwd: destDir, command: ["remote"] })).toBe("");
    expect(
      (
        await runGit({
          cwd: destDir,
          command: [
            "check-ignore",
            "--no-index",
            "--",
            "secrets/token",
            ".nori-version",
            ".nori/state.json",
          ],
        })
      ).split("\n"),
    ).toEqual(["secrets/token", ".nori-version", ".nori/state.json"]);
  });

  it("rejects an interior symlink without leaving a destination", async () => {
    const sourceDir = path.join(skillsetsDir, "personal", "linked-content");
    const externalDir = path.join(testHomeDir, "external-content");
    await fs.mkdir(sourceDir, { recursive: true });
    await fs.mkdir(externalDir);
    await fs.writeFile(
      path.join(sourceDir, "nori.json"),
      JSON.stringify({
        name: "linked-content",
        version: "1.0.0",
        type: "skillset",
      }),
    );
    await fs.symlink(externalDir, path.join(sourceDir, "linked"), "dir");

    await expect(
      forkSkillsetMain({
        baseSkillset: "linked-content",
        newSkillset: "rejected-link",
      }),
    ).rejects.toThrow(/symbolic link/i);
    await expect(
      fs.access(path.join(skillsetsDir, "personal", "rejected-link")),
    ).rejects.toThrow();
  });

  it("rejects a submodule without leaving a destination", async () => {
    const sourceDir = path.join(skillsetsDir, "personal", "with-submodule");
    const moduleDir = path.join(testHomeDir, "module-source");
    const fsmonitorMarker = path.join(testHomeDir, "fsmonitor-ran");
    const fsmonitor = path.join(testHomeDir, "fsmonitor.sh");
    await fs.mkdir(sourceDir, { recursive: true });
    await fs.mkdir(moduleDir);
    await fs.writeFile(
      path.join(sourceDir, "nori.json"),
      JSON.stringify({
        name: "with-submodule",
        version: "1.0.0",
        type: "skillset",
      }),
    );
    await fs.writeFile(path.join(moduleDir, "README.md"), "# Module\n");

    for (const repository of [sourceDir, moduleDir]) {
      await initializeCommittedRepository({ dir: repository });
    }
    const moduleCommit = await runGit({
      cwd: moduleDir,
      command: ["rev-parse", "HEAD"],
    });
    await runGit({
      cwd: sourceDir,
      command: [
        "update-index",
        "--add",
        "--cacheinfo",
        `160000,${moduleCommit},nested`,
      ],
    });
    await fs.writeFile(
      fsmonitor,
      `#!/bin/sh\n: > '${fsmonitorMarker}'\nprintf '\\0'\n`,
      { mode: 0o755 },
    );
    await runGit({
      cwd: sourceDir,
      command: ["config", "core.fsmonitor", fsmonitor],
    });

    await expect(
      forkSkillsetMain({
        baseSkillset: "with-submodule",
        newSkillset: "rejected-submodule",
      }),
    ).rejects.toThrow(/submodule/i);
    await expect(
      fs.access(path.join(skillsetsDir, "personal", "rejected-submodule")),
    ).rejects.toThrow();
    await expect(fs.access(fsmonitorMarker)).rejects.toThrow();
  });

  it.sequential(
    "removes the partial fork when Git is unavailable",
    async () => {
      const sourceDir = path.join(skillsetsDir, "personal", "base-profile");
      await fs.mkdir(sourceDir, { recursive: true });
      await fs.writeFile(
        path.join(sourceDir, "nori.json"),
        JSON.stringify({
          name: "base-profile",
          version: "1.0.0",
          type: "skillset",
        }),
      );
      vi.stubEnv("PATH", "");

      await expect(
        forkSkillsetMain({
          baseSkillset: "base-profile",
          newSkillset: "failed-fork",
        }),
      ).rejects.toThrow(/git.*not installed|git.*path/i);
      await expect(
        fs.access(path.join(skillsetsDir, "personal", "failed-fork")),
      ).rejects.toThrow();
      expect(
        JSON.parse(await fs.readFile(path.join(sourceDir, "nori.json"), "utf8"))
          .name,
      ).toBe("base-profile");
    },
  );

  it("rejects an invalid destination name without creating content outside profiles", async () => {
    const sourceDir = path.join(skillsetsDir, "personal", "base-profile");
    await fs.mkdir(sourceDir, { recursive: true });
    await fs.writeFile(
      path.join(sourceDir, "nori.json"),
      JSON.stringify({
        name: "base-profile",
        version: "1.0.0",
        type: "skillset",
      }),
    );

    const result = await forkSkillsetMain({
      baseSkillset: "base-profile",
      newSkillset: "../escaped",
    });

    expect(result).toMatchObject({ success: false, cancelled: false });
    await expect(
      fs.access(path.join(testHomeDir, ".nori", "escaped")),
    ).rejects.toThrow();
  });

  it("should copy a flat skillset to a new name with all contents", async () => {
    // Create source skillset with multiple files/directories
    const sourceDir = path.join(skillsetsDir, "senior-swe");
    await fs.mkdir(sourceDir, { recursive: true });
    await fs.writeFile(
      path.join(sourceDir, "nori.json"),
      JSON.stringify({ name: "senior-swe", version: "1.0.0" }),
    );
    const skillsDir = path.join(sourceDir, "skills", "my-skill");
    await fs.mkdir(skillsDir, { recursive: true });
    await fs.writeFile(path.join(skillsDir, "SKILL.md"), "# My Skill");

    const result = await forkSkillsetMain({
      baseSkillset: "senior-swe",
      newSkillset: "my-custom",
    });

    // Verify destination exists with all contents (bare fork lands in personal/)
    const destDir = path.join(skillsetsDir, "personal", "my-custom");

    const skillMd = await fs.readFile(
      path.join(destDir, "skills", "my-skill", "SKILL.md"),
      "utf-8",
    );
    expect(skillMd).toBe("# My Skill");

    const noriJson = JSON.parse(
      await fs.readFile(path.join(destDir, "nori.json"), "utf-8"),
    );
    expect(noriJson.name).toBe("my-custom");
    expect(noriJson.version).toBe("1.0.0");

    // Verify return status contains both source and destination
    expect(result.success).toBe(true);
    expect(result.message).toContain("senior-swe");
    expect(result.message).toContain("my-custom");
    expect(mockOutro).not.toHaveBeenCalled();
    expect(mockExit).not.toHaveBeenCalled();
  });

  it("should return failure status when base skillset does not exist", async () => {
    const result = await forkSkillsetMain({
      baseSkillset: "nonexistent",
      newSkillset: "my-copy",
    });

    expect(mockLogError).toHaveBeenCalledWith(
      expect.stringContaining("nonexistent"),
    );
    expect(result.success).toBe(false);
  });

  it("should return failure status when base skillset directory exists but has no nori.json", async () => {
    // Create a directory that is not a valid skillset
    const invalidDir = path.join(skillsetsDir, "not-a-skillset");
    await fs.mkdir(invalidDir, { recursive: true });
    await fs.writeFile(path.join(invalidDir, "readme.txt"), "not a profile");

    const result = await forkSkillsetMain({
      baseSkillset: "not-a-skillset",
      newSkillset: "my-copy",
    });

    expect(mockLogError).toHaveBeenCalledWith(
      expect.stringContaining("not-a-skillset"),
    );
    expect(result.success).toBe(false);
  });

  it("should error when destination skillset already exists", async () => {
    // Create source
    const sourceDir = path.join(skillsetsDir, "base-profile");
    await fs.mkdir(sourceDir, { recursive: true });
    await fs.writeFile(
      path.join(sourceDir, "nori.json"),
      JSON.stringify({ name: "base-profile", version: "1.0.0" }),
    );

    // Create destination that already exists
    const destDir = path.join(skillsetsDir, "existing-profile");
    await fs.mkdir(destDir, { recursive: true });
    await fs.writeFile(
      path.join(destDir, "nori.json"),
      JSON.stringify({ name: "existing-profile", version: "1.0.0" }),
    );

    const result = await forkSkillsetMain({
      baseSkillset: "base-profile",
      newSkillset: "existing-profile",
    });

    expect(mockLogError).toHaveBeenCalledWith(
      expect.stringContaining("existing-profile"),
    );
    expect(mockLogError).toHaveBeenCalledWith(
      expect.stringContaining("already exists"),
    );
    expect(result.success).toBe(false);
  });

  it("should work with namespaced profile names", async () => {
    // Create a namespaced source skillset
    const sourceDir = path.join(skillsetsDir, "myorg", "base-profile");
    await fs.mkdir(sourceDir, { recursive: true });
    await fs.writeFile(
      path.join(sourceDir, "nori.json"),
      JSON.stringify({ name: "base-profile", version: "1.0.0" }),
    );

    await forkSkillsetMain({
      baseSkillset: "myorg/base-profile",
      newSkillset: "myorg/forked-profile",
    });

    // Verify destination exists with updated name
    const destDir = path.join(skillsetsDir, "myorg", "forked-profile");
    const noriJson = JSON.parse(
      await fs.readFile(path.join(destDir, "nori.json"), "utf-8"),
    );
    expect(noriJson.name).toBe("forked-profile");
    expect(noriJson.version).toBe("1.0.0");
    expect(mockExit).not.toHaveBeenCalled();
  });

  it("should create parent directory for namespaced destination", async () => {
    // Create a flat source
    const sourceDir = path.join(skillsetsDir, "senior-swe");
    await fs.mkdir(sourceDir, { recursive: true });
    await fs.writeFile(
      path.join(sourceDir, "nori.json"),
      JSON.stringify({ name: "senior-swe", version: "1.0.0" }),
    );

    // Fork to a new org namespace that doesn't exist yet
    await forkSkillsetMain({
      baseSkillset: "senior-swe",
      newSkillset: "neworg/my-fork",
    });

    const destDir = path.join(skillsetsDir, "neworg", "my-fork");
    const noriJson = JSON.parse(
      await fs.readFile(path.join(destDir, "nori.json"), "utf-8"),
    );
    expect(noriJson.name).toBe("my-fork");
    expect(noriJson.version).toBe("1.0.0");
    expect(mockExit).not.toHaveBeenCalled();
  });

  it("resolves bare base and destination names against the default org", async () => {
    await fs.writeFile(
      path.join(testHomeDir, ".nori-config.json"),
      JSON.stringify({ defaultOrg: "myorg" }),
    );

    // Seed a nested org base skillset
    const sourceDir = path.join(skillsetsDir, "myorg", "base");
    await fs.mkdir(sourceDir, { recursive: true });
    await fs.writeFile(
      path.join(sourceDir, "nori.json"),
      JSON.stringify({ name: "base", version: "1.0.0" }),
    );

    const result = await forkSkillsetMain({
      baseSkillset: "base",
      newSkillset: "newfork",
    });

    // Destination is created under the default org; nori.json stores the basename.
    const destDir = path.join(skillsetsDir, "myorg", "newfork");
    const noriJson = JSON.parse(
      await fs.readFile(path.join(destDir, "nori.json"), "utf-8"),
    );
    expect(noriJson.name).toBe("newfork");
    expect(result.success).toBe(true);
    expect(mockExit).not.toHaveBeenCalled();
  });

  it("should print instructions for switching and editing after fork", async () => {
    const sourceDir = path.join(skillsetsDir, "senior-swe");
    await fs.mkdir(sourceDir, { recursive: true });
    await fs.writeFile(
      path.join(sourceDir, "nori.json"),
      JSON.stringify({ name: "senior-swe", version: "1.0.0" }),
    );

    await forkSkillsetMain({
      baseSkillset: "senior-swe",
      newSkillset: "my-fork",
    });

    // Should show note with next steps containing switch and edit instructions
    expect(mockNote).toHaveBeenCalledWith(
      expect.stringContaining("switch personal/my-fork"),
      "Next Steps",
    );
    expect(mockNote).toHaveBeenCalledWith(
      expect.stringContaining("~/.nori/profiles/personal/my-fork"),
      "Next Steps",
    );
  });
});
