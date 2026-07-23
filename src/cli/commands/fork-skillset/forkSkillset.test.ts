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

const writeSkillsetFixture = async (args: {
  root: string;
  name: string;
  files?: Record<string, string>;
}): Promise<void> =>
  writeFixtureTree({
    root: args.root,
    files: {
      "nori.json": JSON.stringify({
        name: args.name,
        version: "1.0.0",
        type: "skillset",
      }),
      ...args.files,
    },
  });

const expectPathsMissing = async (args: {
  root: string;
  paths: ReadonlyArray<string>;
}): Promise<void> => {
  for (const relativePath of args.paths) {
    await expect(
      fs.access(path.join(args.root, relativePath)),
    ).rejects.toThrow();
  }
};

const expectFile = async (
  root: string,
  file: string,
  content: string,
): Promise<void> => {
  expect(await fs.readFile(path.join(root, file), "utf8")).toBe(content);
};

const readManifest = async (root: string): Promise<Record<string, unknown>> =>
  JSON.parse(await fs.readFile(path.join(root, "nori.json"), "utf8"));

const expectForkRejected = async (args: {
  baseSkillset: string;
  newSkillset: string;
  skillsetsDir: string;
  error: RegExp;
}): Promise<void> => {
  await expect(
    forkSkillsetMain({
      baseSkillset: args.baseSkillset,
      newSkillset: args.newSkillset,
    }),
  ).rejects.toThrow(args.error);
  await expect(
    fs.access(path.join(args.skillsetsDir, "personal", args.newSkillset)),
  ).rejects.toThrow();
};

const pathsResolveToSameEntry = async (args: {
  first: string;
  second: string;
}): Promise<boolean> => {
  const [first, second] = await Promise.all(
    [args.first, args.second].map((entry) =>
      fs.realpath(entry).catch(() => null),
    ),
  );
  return first != null && first === second;
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
        ".gitignore": "secrets/\n",
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
    const gitIsCaseAlias = await pathsResolveToSameEntry({
      first: path.join(sourceDir, ".git"),
      second: path.join(sourceDir, ".GIT"),
    });
    if (!gitIsCaseAlias) {
      await writeFixtureTree({
        root: sourceDir,
        files: {
          ".GIT/authored.txt": "case-sensitive authored content\n",
        },
      });
    }
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
    for (const file of ["nori.json", ".gitignore"]) {
      await fs.chmod(path.join(sourceDir, file), 0o444);
    }
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
    await expectFile(destDir, "skills/demo/SKILL.md", "# Demo\n");
    await expectFile(destDir, "README.md", "# Authored docs\n");
    await expectFile(destDir, ".claude/settings.json", "{}\n");
    if (!gitIsCaseAlias) {
      await expectFile(
        destDir,
        ".GIT/authored.txt",
        "case-sensitive authored content\n",
      );
    }
    await expectFile(destDir, ".github/workflows/ci.yml", "name: authored\n");

    const manifest = await readManifest(destDir);
    expect(manifest).toMatchObject({
      name: "independent-fork",
      version: "1.2.3",
      type: "skillset",
      repository: "https://example.invalid/authored-package",
    });
    expect(manifest.registryURL).toBeUndefined();
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

    await expectPathsMissing({
      root: destDir,
      paths: [
        ".nori-version",
        ".nori",
        ".nori-managed",
        ".nori-config.json",
        ".nori-installed-version",
        "node_modules",
        ".claude/.nori-managed",
        ".mcp.json",
        "skills/demo/.nori-version",
      ],
    });

    expect(
      await runGit({ cwd: sourceDir, command: ["rev-parse", "HEAD"] }),
    ).toBe(sourceHead);
    expect(
      await runGit({ cwd: sourceDir, command: ["status", "--porcelain"] }),
    ).toBe(sourceStatus);
    for (const file of ["nori.json", ".gitignore"]) {
      expect((await fs.stat(path.join(sourceDir, file))).mode & 0o777).toBe(
        0o444,
      );
    }
    const sourceManifest = await readManifest(sourceDir);
    expect(sourceManifest.name).toBe("linked-source");
  });

  it("preserves authored GitHub content while removing marked Copilot output", async () => {
    const sourceDir = path.join(skillsetsDir, "personal", "copilot-source");
    await writeSkillsetFixture({
      root: sourceDir,
      name: "copilot-source",
      files: {
        ".github/.nori-managed": "copilot-source\n",
        ".github/copilot-instructions.md": "generated instructions\n",
        ".github/skills/demo/SKILL.md": "# Generated skill\n",
        ".github/agents/reviewer.md": "generated agent\n",
        ".github/prompts/review.md": "generated prompt\n",
        ".github/workflows/ci.yml": "name: authored workflow\n",
        ".github/CODEOWNERS": "* @maintainers\n",
      },
    });
    const destGithubDir = path.join(
      skillsetsDir,
      "personal",
      "copilot-fork",
      ".github",
    );
    await fs.chmod(path.join(sourceDir, ".github"), 0o555);

    try {
      const result = await forkSkillsetMain({
        baseSkillset: "copilot-source",
        newSkillset: "copilot-fork",
      });
      expect(result.success).toBe(true);
      await expectFile(
        destGithubDir,
        "workflows/ci.yml",
        "name: authored workflow\n",
      );
      await expectFile(destGithubDir, "CODEOWNERS", "* @maintainers\n");
      await expectPathsMissing({
        root: destGithubDir,
        paths: [
          ".nori-managed",
          "copilot-instructions.md",
          "skills",
          "agents",
          "prompts",
        ],
      });
      expect(
        (await fs.stat(path.join(sourceDir, ".github"))).mode & 0o777,
      ).toBe(0o555);
      await expectFile(
        sourceDir,
        ".github/agents/reviewer.md",
        "generated agent\n",
      );
    } finally {
      await fs.chmod(path.join(sourceDir, ".github"), 0o755);
      await fs.chmod(destGithubDir, 0o755).catch(() => undefined);
    }
  });

  it("removes nested marked Pi output while preserving Pi siblings", async () => {
    const sourceDir = path.join(skillsetsDir, "personal", "pi-source");
    await writeSkillsetFixture({
      root: sourceDir,
      name: "pi-source",
      files: {
        ".pi/settings.json": '{"authored":true}\n',
        ".pi/agent/.nori-managed": "pi-source\n",
        ".pi/agent/AGENTS.md": "generated instructions\n",
        ".pi/agent/skills/demo/SKILL.md": "# Generated skill\n",
        ".pi/agent/subagents/reviewer.md": "generated agent\n",
        ".pi/agent/prompts/review.md": "generated prompt\n",
      },
    });

    const result = await forkSkillsetMain({
      baseSkillset: "pi-source",
      newSkillset: "pi-fork",
    });

    const destPiDir = path.join(skillsetsDir, "personal", "pi-fork", ".pi");
    expect(result.success).toBe(true);
    await expectFile(destPiDir, "settings.json", '{"authored":true}\n');
    expect(await fs.readdir(path.join(destPiDir, "agent"))).toEqual([]);
  });

  it("preserves authored Cursor and Codex files outside exact generated paths", async () => {
    const sourceDir = path.join(skillsetsDir, "personal", "mixed-providers");
    await writeSkillsetFixture({
      root: sourceDir,
      name: "mixed-providers",
      files: {
        "AGENTS.md": "# Canonical instructions\n",
        ".cursor/.nori-managed": "mixed-providers\n",
        ".cursor/rules/AGENTS.md": "generated instructions\n",
        ".cursor/rules/custom.mdc": "authored rule\n",
        ".codex/.nori-managed": "mixed-providers\n",
        ".codex/AGENTS.md": "authored Codex notes\n",
        ".codex/config.toml": "[mcp_servers.generated]\n",
      },
    });

    const result = await forkSkillsetMain({
      baseSkillset: "mixed-providers",
      newSkillset: "mixed-providers-fork",
    });

    const destDir = path.join(skillsetsDir, "personal", "mixed-providers-fork");
    expect(result.success).toBe(true);
    await expectFile(destDir, "AGENTS.md", "# Canonical instructions\n");
    await expectFile(destDir, ".cursor/rules/custom.mdc", "authored rule\n");
    await expectFile(destDir, ".codex/AGENTS.md", "authored Codex notes\n");
    await expectPathsMissing({
      root: destDir,
      paths: [
        path.join(".cursor", "rules", "AGENTS.md"),
        path.join(".codex", "config.toml"),
      ],
    });
  });

  it.each([
    {
      label: "managed marker",
      sourceName: "linked-marker",
      destinationName: "rejected-linked-marker",
      linkPath: ".github/.nori-managed",
      target: "external-file",
    },
    {
      label: "excluded Nori-state alias",
      sourceName: "linked-nori-state",
      destinationName: "rejected-linked-nori-state",
      linkPath: "provenance-alias",
      target: ".nori-version",
    },
    {
      label: "interior directory",
      sourceName: "linked-content",
      destinationName: "rejected-link",
      linkPath: "linked",
      target: "external-directory",
    },
  ])(
    "rejects a $label symlink without leaving a destination",
    async ({ sourceName, destinationName, linkPath, target }) => {
      const sourceDir = path.join(skillsetsDir, "personal", sourceName);
      const sourceFiles =
        target === ".nori-version"
          ? { ".nori-version": "registry\n" }
          : undefined;
      await writeSkillsetFixture({
        root: sourceDir,
        name: sourceName,
        files: sourceFiles,
      });
      await fs.mkdir(path.dirname(path.join(sourceDir, linkPath)), {
        recursive: true,
      });

      let linkTarget = target;
      let linkType: "file" | "dir" = "file";
      if (target === "external-file") {
        linkTarget = path.join(testHomeDir, "marker-target");
        await fs.writeFile(linkTarget, "linked-marker\n");
      } else if (target === "external-directory") {
        linkTarget = path.join(testHomeDir, "external-content");
        await fs.mkdir(linkTarget);
        linkType = "dir";
      }
      await fs.symlink(linkTarget, path.join(sourceDir, linkPath), linkType);

      await expectForkRejected({
        baseSkillset: sourceName,
        newSkillset: destinationName,
        skillsetsDir,
        error: /symbolic link/i,
      });
    },
  );

  it("rejects a nested repository without leaving a destination", async () => {
    const sourceDir = path.join(skillsetsDir, "personal", "nested-repository");
    const nestedDir = path.join(sourceDir, "nested");
    await writeSkillsetFixture({
      root: sourceDir,
      name: "nested-repository",
      files: {
        "nested/README.md": "# Nested repository\n",
      },
    });
    await initializeCommittedRepository({ dir: nestedDir });
    const nestedHead = await runGit({
      cwd: nestedDir,
      command: ["rev-parse", "HEAD"],
    });

    await expectForkRejected({
      baseSkillset: "nested-repository",
      newSkillset: "rejected-nested-repository",
      skillsetsDir,
      error: /nested Git repositories/i,
    });
    expect(
      await runGit({ cwd: nestedDir, command: ["rev-parse", "HEAD"] }),
    ).toBe(nestedHead);
  });

  it("treats case-only Nori path aliases according to filesystem semantics", async () => {
    const sourceDir = path.join(skillsetsDir, "personal", "case-alias");
    await writeSkillsetFixture({
      root: sourceDir,
      name: "case-alias",
      files: {
        ".NORI-VERSION": "case-sensitive authored content\n",
        ".GITHUB/.nori-managed": "case-alias\n",
        ".GITHUB/agents/generated.md": "generated agent\n",
        ".GITHUB/workflows/authored.yml": "name: authored\n",
      },
    });
    const provenanceIsCaseAlias = await pathsResolveToSameEntry({
      first: path.join(sourceDir, ".nori-version"),
      second: path.join(sourceDir, ".NORI-VERSION"),
    });
    const providerIsCaseAlias = await pathsResolveToSameEntry({
      first: path.join(sourceDir, ".github"),
      second: path.join(sourceDir, ".GITHUB"),
    });

    const result = await forkSkillsetMain({
      baseSkillset: "case-alias",
      newSkillset: "case-alias-fork",
    });

    expect(result.success).toBe(true);
    const copiedAlias = path.join(
      skillsetsDir,
      "personal",
      "case-alias-fork",
      ".NORI-VERSION",
    );
    if (provenanceIsCaseAlias) {
      await expect(fs.access(copiedAlias)).rejects.toThrow();
    } else {
      expect(await fs.readFile(copiedAlias, "utf8")).toBe(
        "case-sensitive authored content\n",
      );
    }
    const copiedProvider = path.join(
      skillsetsDir,
      "personal",
      "case-alias-fork",
      ".GITHUB",
    );
    await expectFile(
      copiedProvider,
      "workflows/authored.yml",
      "name: authored\n",
    );
    if (providerIsCaseAlias) {
      await expectPathsMissing({ root: copiedProvider, paths: ["agents"] });
    } else {
      await expectFile(
        copiedProvider,
        "agents/generated.md",
        "generated agent\n",
      );
    }
  });

  it("rejects a submodule without leaving a destination", async () => {
    const sourceDir = path.join(skillsetsDir, "personal", "with-submodule");
    const moduleDir = path.join(testHomeDir, "module-source");
    const fsmonitorMarker = path.join(testHomeDir, "fsmonitor-ran");
    const fsmonitor = path.join(testHomeDir, "fsmonitor.sh");
    await writeSkillsetFixture({
      root: sourceDir,
      name: "with-submodule",
    });
    await fs.mkdir(moduleDir);
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

    await expectForkRejected({
      baseSkillset: "with-submodule",
      newSkillset: "rejected-submodule",
      skillsetsDir,
      error: /submodule/i,
    });
    await expect(fs.access(fsmonitorMarker)).rejects.toThrow();
  });

  it.sequential(
    "removes the partial fork when Git is unavailable",
    async () => {
      const sourceDir = path.join(skillsetsDir, "personal", "base-profile");
      const destDir = path.join(skillsetsDir, "personal", "failed-fork");
      const readonlyDir = path.join(sourceDir, "readonly");
      await writeSkillsetFixture({
        root: sourceDir,
        name: "base-profile",
        files: { "readonly/authored.txt": "authored\n" },
      });
      await fs.chmod(readonlyDir, 0o555);
      vi.stubEnv("PATH", "");

      try {
        await expect(
          forkSkillsetMain({
            baseSkillset: "base-profile",
            newSkillset: "failed-fork",
          }),
        ).rejects.toThrow(/git.*not installed|git.*path/i);
        await expect(fs.access(destDir)).rejects.toThrow();
        expect((await fs.stat(readonlyDir)).mode & 0o777).toBe(0o555);
        expect(
          await fs.readFile(path.join(readonlyDir, "authored.txt"), "utf8"),
        ).toBe("authored\n");
        expect((await readManifest(sourceDir)).name).toBe("base-profile");
      } finally {
        await Promise.all(
          [sourceDir, destDir].map((dir) =>
            fs.chmod(path.join(dir, "readonly"), 0o755).catch(() => undefined),
          ),
        );
      }
    },
  );

  it("rejects an invalid destination name without creating content outside profiles", async () => {
    const sourceDir = path.join(skillsetsDir, "personal", "base-profile");
    await writeSkillsetFixture({
      root: sourceDir,
      name: "base-profile",
    });

    const result = await forkSkillsetMain({
      baseSkillset: "base-profile",
      newSkillset: "../escaped",
    });

    expect(result).toMatchObject({ success: false, cancelled: false });
    await expect(
      fs.access(path.join(testHomeDir, ".nori", "escaped")),
    ).rejects.toThrow();
  });

  it("rejects an invalid default org before deriving the destination", async () => {
    const sourceDir = path.join(skillsetsDir, "personal", "base-profile");
    await writeSkillsetFixture({
      root: sourceDir,
      name: "base-profile",
    });
    await fs.writeFile(
      path.join(testHomeDir, ".nori-config.json"),
      JSON.stringify({
        defaultOrg: "../../escaped",
        sendSessionTranscript: "disabled",
      }),
    );

    const result = await forkSkillsetMain({
      baseSkillset: "personal/base-profile",
      newSkillset: "fork",
    });

    expect(result).toMatchObject({ success: false, cancelled: false });
    await expect(
      fs.access(path.join(testHomeDir, "escaped", "fork")),
    ).rejects.toThrow();
  });

  it("rejects a namespace symlink that redirects the destination outside profiles", async () => {
    const sourceDir = path.join(skillsetsDir, "personal", "base-profile");
    const outsideDir = path.join(testHomeDir, "outside");
    await writeSkillsetFixture({
      root: sourceDir,
      name: "base-profile",
    });
    await fs.mkdir(outsideDir);
    await fs.symlink(outsideDir, path.join(skillsetsDir, "org"), "dir");

    await expect(
      forkSkillsetMain({
        baseSkillset: "personal/base-profile",
        newSkillset: "org/fork",
      }),
    ).rejects.toThrow(/destination.*profiles/i);
    await expect(fs.access(path.join(outsideDir, "fork"))).rejects.toThrow();
  });

  it("rejects a linked source that contains its own destination", async () => {
    await writeSkillsetFixture({
      root: testHomeDir,
      name: "home-source",
      files: {
        ".config/goose/.nori-managed": "home-source\n",
        ".config/goose/skills/generated/SKILL.md": "# Generated\n",
      },
    });
    await fs.mkdir(path.join(skillsetsDir, "personal"), { recursive: true });
    await fs.symlink(
      testHomeDir,
      path.join(skillsetsDir, "personal", "home-source"),
      "dir",
    );

    await expect(
      forkSkillsetMain({
        baseSkillset: "home-source",
        newSkillset: "home-fork",
      }),
    ).rejects.toThrow(/destination.*source/i);
    await expect(
      fs.access(path.join(skillsetsDir, "personal", "home-fork")),
    ).rejects.toThrow();
    expect(
      await fs.readFile(
        path.join(
          testHomeDir,
          ".config",
          "goose",
          "skills",
          "generated",
          "SKILL.md",
        ),
        "utf8",
      ),
    ).toBe("# Generated\n");
  });

  it("should copy a flat skillset to a new name with all contents", async () => {
    const sourceDir = path.join(skillsetsDir, "senior-swe");
    await writeSkillsetFixture({
      root: sourceDir,
      name: "senior-swe",
      files: { "skills/my-skill/SKILL.md": "# My Skill" },
    });

    const result = await forkSkillsetMain({
      baseSkillset: "senior-swe",
      newSkillset: "my-custom",
    });

    const destDir = path.join(skillsetsDir, "personal", "my-custom");

    const skillMd = await fs.readFile(
      path.join(destDir, "skills", "my-skill", "SKILL.md"),
      "utf-8",
    );
    expect(skillMd).toBe("# My Skill");

    const noriJson = await readManifest(destDir);
    expect(noriJson.name).toBe("my-custom");
    expect(noriJson.version).toBe("1.0.0");

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
    const sourceDir = path.join(skillsetsDir, "base-profile");
    await writeSkillsetFixture({
      root: sourceDir,
      name: "base-profile",
    });

    const destDir = path.join(skillsetsDir, "existing-profile");
    await writeSkillsetFixture({
      root: destDir,
      name: "existing-profile",
    });

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
    const sourceDir = path.join(skillsetsDir, "myorg", "base-profile");
    await writeSkillsetFixture({
      root: sourceDir,
      name: "base-profile",
    });

    await forkSkillsetMain({
      baseSkillset: "myorg/base-profile",
      newSkillset: "myorg/forked-profile",
    });

    const destDir = path.join(skillsetsDir, "myorg", "forked-profile");
    const noriJson = await readManifest(destDir);
    expect(noriJson.name).toBe("forked-profile");
    expect(noriJson.version).toBe("1.0.0");
    expect(mockExit).not.toHaveBeenCalled();
  });

  it("should create parent directory for namespaced destination", async () => {
    const sourceDir = path.join(skillsetsDir, "senior-swe");
    await writeSkillsetFixture({
      root: sourceDir,
      name: "senior-swe",
    });

    await forkSkillsetMain({
      baseSkillset: "senior-swe",
      newSkillset: "neworg/my-fork",
    });

    const destDir = path.join(skillsetsDir, "neworg", "my-fork");
    const noriJson = await readManifest(destDir);
    expect(noriJson.name).toBe("my-fork");
    expect(noriJson.version).toBe("1.0.0");
    expect(mockExit).not.toHaveBeenCalled();
  });

  it("resolves bare base and destination names against the default org", async () => {
    await fs.writeFile(
      path.join(testHomeDir, ".nori-config.json"),
      JSON.stringify({ defaultOrg: "myorg" }),
    );

    const sourceDir = path.join(skillsetsDir, "myorg", "base");
    await writeSkillsetFixture({
      root: sourceDir,
      name: "base",
    });

    const result = await forkSkillsetMain({
      baseSkillset: "base",
      newSkillset: "newfork",
    });

    const destDir = path.join(skillsetsDir, "myorg", "newfork");
    const noriJson = await readManifest(destDir);
    expect(noriJson.name).toBe("newfork");
    expect(result.success).toBe(true);
    expect(mockExit).not.toHaveBeenCalled();
  });

  it("should print instructions for switching and editing after fork", async () => {
    const sourceDir = path.join(skillsetsDir, "senior-swe");
    await writeSkillsetFixture({
      root: sourceDir,
      name: "senior-swe",
    });

    await forkSkillsetMain({
      baseSkillset: "senior-swe",
      newSkillset: "my-fork",
    });

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
