import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { updateConfig } from "@/cli/config.js";

import type * as clackPrompts from "@clack/prompts";

import { publishSkillsetMain } from "./publishSkillset.js";

const execFileAsync = promisify(execFile);
const prompt = vi.hoisted(() => ({
  cancel: Symbol("cancel"),
  confirm: vi.fn(),
  note: vi.fn(),
}));

vi.mock("os", async (importOriginal) => {
  const actual = await importOriginal<typeof os>();
  return {
    ...actual,
    homedir: vi.fn().mockReturnValue(actual.homedir()),
  };
});

vi.mock("@clack/prompts", async (importOriginal) => ({
  ...(await importOriginal<typeof clackPrompts>()),
  confirm: prompt.confirm,
  isCancel: (value: unknown) => value === prompt.cancel,
  note: prompt.note,
}));

const git = async (
  cwd: string | undefined,
  ...command: Array<string>
): Promise<string> =>
  (
    await execFileAsync("git", command, {
      cwd,
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" },
    })
  ).stdout.trim();

describe("publishSkillsetMain", () => {
  let testHome: string;
  let profilesDir: string;
  let remote: string;

  const createSkillset = async (
    args: {
      files?: Record<string, string>;
      manifest?: Record<string, unknown>;
      name?: string;
      namespace?: string;
    } = {},
  ): Promise<string> => {
    const name = args.name ?? "reviewer";
    const dir = path.join(profilesDir, args.namespace ?? "personal", name);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, "nori.json"),
      JSON.stringify({
        name,
        version: "1.0.0",
        type: "skillset",
        ...args.manifest,
      }),
    );
    await fs.writeFile(path.join(dir, "AGENTS.md"), "# Reviewer\n");
    await fs.writeFile(path.join(dir, ".gitignore"), ".nori-version\n");
    for (const [relativePath, contents] of Object.entries(args.files ?? {})) {
      const filePath = path.join(dir, relativePath);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, contents);
    }
    await git(dir, "init", "--quiet", "--template=");
    await git(dir, "config", "user.name", "Feature Seven");
    await git(dir, "config", "user.email", "feature-seven@nori.invalid");
    return dir;
  };

  const commitAll = async (
    dir: string,
    message = "baseline",
  ): Promise<string> => {
    await git(dir, "add", "-A");
    await git(dir, "commit", "--quiet", "-m", message);
    return git(dir, "rev-parse", "HEAD");
  };

  const publish = (
    overrides: Partial<Parameters<typeof publishSkillsetMain>[0]> = {},
  ) =>
    publishSkillsetMain({
      skillset: "reviewer",
      remote,
      nonInteractive: true,
      silent: false,
      yes: true,
      ...overrides,
    });

  const remoteHead = (slug = "reviewer"): Promise<string> =>
    git(remote, "rev-parse", `refs/heads/skillsets/${slug}`);

  beforeEach(async () => {
    vi.clearAllMocks();
    prompt.confirm.mockResolvedValue(true);
    testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nori-publish-"));
    vi.mocked(os.homedir).mockReturnValue(testHome);
    profilesDir = path.join(testHome, ".nori", "profiles");
    remote = path.join(testHome, "remote.git");
    await fs.mkdir(profilesDir, { recursive: true });
    await git(undefined, "init", "--bare", "--quiet", remote);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(testHome, { recursive: true, force: true });
  });

  it("publishes an unborn repository as one reviewed commit without configuring a remote", async () => {
    const dir = await createSkillset({
      files: {
        ".nori-version": "ignored Registrar state\n",
        "preview.txt": "\u001b[31mterminal spoof\u001b[0m\n",
        "skills/review/SKILL.md": "# Review\n",
      },
    });

    const result = await publish();

    expect(result).toMatchObject({ success: true, cancelled: false });
    expect(await remoteHead()).toBe(await git(dir, "rev-parse", "HEAD"));
    expect(await git(dir, "log", "-1", "--format=%s")).toBe("Publish reviewer");
    expect(await git(dir, "log", "-1", "--format=%an <%ae>")).toBe(
      "Feature Seven <feature-seven@nori.invalid>",
    );
    expect(
      await git(remote, "show", "skillsets/reviewer:skills/review/SKILL.md"),
    ).toBe("# Review");
    await expect(
      git(remote, "show", "skillsets/reviewer:.nori-version"),
    ).rejects.toBeDefined();
    expect(await git(dir, "remote")).toBe("");
    expect(prompt.note).toHaveBeenCalledWith(
      expect.stringMatching(/nori\.json[\s\S]*skills\/review\/SKILL\.md/),
      expect.any(String),
    );
    const preview = String(prompt.note.mock.calls[0]?.[0]);
    expect(preview).toContain("\n");
    expect(preview).not.toContain("\u001b");
  });

  it("pushes a clean HEAD unchanged and commits later changes with a custom message", async () => {
    const dir = await createSkillset();
    const originalHead = await commitAll(dir);

    expect((await publish()).success).toBe(true);
    expect(await git(dir, "rev-parse", "HEAD")).toBe(originalHead);

    await fs.writeFile(path.join(dir, "README.md"), "# Published\n");
    await git(dir, "add", "README.md");
    await fs.writeFile(path.join(dir, "CHANGELOG.md"), "# Changes\n");
    expect(
      (
        await publish({
          message: "Document the reviewer",
        })
      ).success,
    ).toBe(true);
    expect(await git(dir, "log", "-1", "--format=%s")).toBe(
      "Document the reviewer",
    );
    expect(await remoteHead()).toBe(await git(dir, "rev-parse", "HEAD"));
    expect(await git(remote, "show", "skillsets/reviewer:README.md")).toBe(
      "# Published",
    );
    expect(await git(remote, "show", "skillsets/reviewer:CHANGELOG.md")).toBe(
      "# Changes",
    );
    expect(await git(dir, "rev-list", "--count", "HEAD")).toBe("2");
  });

  it("restores the prior index and does not publish when approval is declined", async () => {
    const dir = await createSkillset();
    await commitAll(dir);
    await fs.writeFile(path.join(dir, "staged.md"), "staged\n");
    await git(dir, "add", "staged.md");
    await fs.writeFile(path.join(dir, "unstaged.md"), "unstaged\n");
    await git(dir, "update-index", "--skip-worktree", "AGENTS.md");
    const originalIndex = await git(dir, "write-tree");
    prompt.confirm.mockResolvedValueOnce(false);

    const result = await publish({
      nonInteractive: false,
      yes: false,
    });

    expect(result).toMatchObject({ success: false, cancelled: true });
    expect(await git(dir, "write-tree")).toBe(originalIndex);
    expect(await git(dir, "diff", "--cached", "--name-only")).toBe("staged.md");
    expect(await git(dir, "ls-files", "-v", "AGENTS.md")).toBe("S AGENTS.md");
    expect(await git(dir, "status", "--short")).toContain("?? unstaged.md");
    await expect(remoteHead()).rejects.toBeDefined();
  });

  it("requires --yes in non-interactive mode before creating history", async () => {
    const dir = await createSkillset();

    const result = await publish({ yes: false });

    expect(result).toMatchObject({ success: false, cancelled: false });
    expect(result.message).toMatch(/--yes/i);
    await expect(
      git(dir, "rev-parse", "--verify", "HEAD"),
    ).rejects.toBeDefined();
    await expect(remoteHead()).rejects.toBeDefined();
  });

  it("keeps its local commit when the remote rejects a non-fast-forward push", async () => {
    const dir = await createSkillset();
    expect((await publish()).success).toBe(true);
    const publishedHead = await remoteHead();

    const competing = path.join(testHome, "competing");
    await git(
      undefined,
      "clone",
      "--quiet",
      "--branch",
      "skillsets/reviewer",
      remote,
      competing,
    );
    await git(competing, "config", "user.name", "Competing Author");
    await git(competing, "config", "user.email", "competing@nori.invalid");
    await fs.writeFile(path.join(competing, "remote.md"), "remote\n");
    await git(competing, "add", "-A");
    await git(competing, "commit", "--quiet", "-m", "remote advance");
    await git(
      competing,
      "push",
      "--quiet",
      "origin",
      "HEAD:skillsets/reviewer",
    );
    const competingHead = await remoteHead();

    await fs.writeFile(path.join(dir, "local.md"), "local\n");
    const result = await publish();
    const localHead = await git(dir, "rev-parse", "HEAD");

    expect(result).toMatchObject({ success: false, cancelled: false });
    expect(result.message).toMatch(/fast-forward|fetch|remote/i);
    expect(localHead).not.toBe(publishedHead);
    expect(await remoteHead()).toBe(competingHead);
    expect(await git(dir, "status", "--short")).toBe("");
  });

  it("does not push when a commit hook changes the reviewed package tree", async () => {
    const dir = await createSkillset();
    const hookPath = path.join(dir, ".git", "hooks", "pre-commit");
    await fs.mkdir(path.dirname(hookPath), { recursive: true });
    await fs.writeFile(
      hookPath,
      [
        "#!/bin/sh",
        "printf 'Registrar state\\n' > .nori-version",
        "git add --force .nori-version",
        "",
      ].join("\n"),
      { mode: 0o755 },
    );

    const result = await publish();

    expect(result).toMatchObject({ success: false, cancelled: false });
    expect(result.message).toMatch(/commit|review|validated|changed/i);
    expect(await git(dir, "show", "HEAD:.nori-version")).toBe(
      "Registrar state",
    );
    await expect(remoteHead()).rejects.toBeDefined();
  });

  it("publishes only complete supported dependencies", async () => {
    await createSkillset({
      manifest: {
        dependencies: {
          skills: { formatter: "*" },
          subagents: { reviewer: "*", tester: "*" },
        },
      },
      files: {
        "skills/formatter/SKILL.md": "# Formatter\n",
        "subagents/reviewer/SUBAGENT.md": "# Reviewer\n",
        "subagents/tester.md": "# Tester\n",
      },
    });
    expect((await publish()).success).toBe(true);

    const invalidCases = [
      {
        name: "missing-skill",
        manifest: { dependencies: { skills: { absent: "*" } } },
        error: /skill.*absent/i,
      },
      {
        name: "missing-subagent",
        manifest: { dependencies: { subagents: { absent: "*" } } },
        error: /subagent.*absent/i,
      },
      {
        name: "unsupported-command",
        manifest: { dependencies: { slashCommands: { inspect: "*" } } },
        error: /slash.*unsupported/i,
      },
      {
        name: "unsafe-dependency",
        manifest: { dependencies: { skills: { "../outside": "*" } } },
        error: /dependency.*name|invalid.*dependency/i,
      },
    ];
    for (const testCase of invalidCases) {
      await createSkillset({
        name: testCase.name,
        manifest: testCase.manifest,
      });
      const result = await publish({ skillset: `personal/${testCase.name}` });
      expect(result.success).toBe(false);
      expect(result.message).toMatch(testCase.error);
      await expect(remoteHead(testCase.name)).rejects.toBeDefined();
    }
  });

  it("rejects package entries that Git-backed installation cannot consume", async () => {
    const cases = [
      {
        name: "registry-state",
        prepare: async (dir: string) => {
          await fs.writeFile(path.join(dir, ".nori-version"), "1.0.0\n");
          await git(dir, "add", "--force", ".nori-version");
        },
        error: /registry.*provenance|nori-version/i,
      },
      {
        name: "linked-content",
        prepare: async (dir: string) => {
          await fs.symlink("AGENTS.md", path.join(dir, "linked.md"));
          await git(dir, "add", "linked.md");
        },
        error: /symbolic link|symlink/i,
      },
      {
        name: "submodule-content",
        prepare: async (dir: string) => {
          const source = path.join(testHome, "submodule-source");
          await fs.mkdir(source);
          await fs.writeFile(path.join(source, "README.md"), "nested\n");
          await git(source, "init", "--quiet", "--template=");
          await git(source, "config", "user.name", "Nested Author");
          await git(source, "config", "user.email", "nested@nori.invalid");
          await git(source, "add", "-A");
          await git(source, "commit", "--quiet", "-m", "nested");
          await git(
            dir,
            "-c",
            "protocol.file.allow=always",
            "submodule",
            "add",
            "--quiet",
            source,
            "nested-repository",
          );
        },
        error: /submodule/i,
      },
    ];

    for (const testCase of cases) {
      const dir = await createSkillset({ name: testCase.name });
      await testCase.prepare(dir);
      const originalIndex = await git(dir, "write-tree");
      const result = await publish({ skillset: `personal/${testCase.name}` });
      expect(result.success).toBe(false);
      expect(result.message).toMatch(testCase.error);
      expect(await git(dir, "write-tree")).toBe(originalIndex);
      await expect(remoteHead(testCase.name)).rejects.toBeDefined();
    }
  });

  it("resolves default-org profiles but rejects a skillset nested in another repository", async () => {
    await updateConfig({ defaultOrg: "acme" });
    const namespacedDir = await createSkillset({ namespace: "acme" });
    expect((await publish()).success).toBe(true);
    expect(await remoteHead()).toBe(
      await git(namespacedDir, "rev-parse", "HEAD"),
    );

    const nestedName = "nested";
    const nestedDir = path.join(profilesDir, "personal", nestedName);
    await fs.mkdir(nestedDir, { recursive: true });
    await fs.writeFile(
      path.join(nestedDir, "nori.json"),
      JSON.stringify({
        name: nestedName,
        version: "1.0.0",
        type: "skillset",
      }),
    );
    await git(profilesDir, "init", "--quiet", "--template=");
    const result = await publish({ skillset: `personal/${nestedName}` });
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/repository root/i);
  });

  it("restores the original index when Git cannot create the commit", async () => {
    const dir = await createSkillset();
    await fs.writeFile(path.join(dir, "previously-staged.md"), "staged\n");
    await git(dir, "add", "previously-staged.md");
    const originalIndex = await git(dir, "write-tree");
    await git(dir, "config", "--unset-all", "user.name");
    await git(dir, "config", "--unset-all", "user.email");
    const emptyGlobalConfig = path.join(testHome, "empty-gitconfig");
    await fs.writeFile(emptyGlobalConfig, "");
    vi.stubEnv("GIT_CONFIG_GLOBAL", emptyGlobalConfig);

    const result = await publish();

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/identity|name|email/i);
    expect(await git(dir, "write-tree")).toBe(originalIndex);
    await expect(
      git(dir, "rev-parse", "--verify", "HEAD"),
    ).rejects.toBeDefined();
    await expect(remoteHead()).rejects.toBeDefined();
  });

  it("rejects manifest name and type mismatches before publishing", async () => {
    await createSkillset({
      name: "wrong-name",
      manifest: { name: "different" },
    });
    expect(
      (await publish({ skillset: "personal/wrong-name" })).message,
    ).toMatch(/different.*wrong-name|wrong-name.*different/i);

    await createSkillset({
      name: "wrong-type",
      manifest: { type: "skill" },
    });
    expect(
      (await publish({ skillset: "personal/wrong-type" })).message,
    ).toMatch(/type.*skillset/i);
  });

  it("redacts credentials from actionable push failures", async () => {
    await createSkillset({ name: "private-source" });
    const result = await publish({
      skillset: "personal/private-source",
      remote:
        "http://publisher:super-secret@127.0.0.1:1/repository.git?token=hidden-value#private-fragment",
    });
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/push|remote|connect|unable|failed/i);
    expect(result.message).not.toContain("publisher");
    expect(result.message).not.toContain("super-secret");
    expect(result.message).not.toContain("hidden-value");
    expect(result.message).not.toContain("private-fragment");
  });
});
