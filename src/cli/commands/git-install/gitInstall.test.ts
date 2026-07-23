import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import { createServer } from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { updateConfig } from "@/cli/config.js";
import * as jsonFile from "@/utils/jsonFile.js";

import type * as clackPrompts from "@clack/prompts";
import type { AddressInfo } from "node:net";

import { gitInstallMain } from "./gitInstall.js";
import { createTestGitRepository } from "../../../../tests/helpers/gitRepository.js";

const prompt = vi.hoisted(() => ({
  cancel: Symbol("cancel"),
  confirm: vi.fn(),
}));

vi.mock("@clack/prompts", async (importOriginal) => ({
  ...(await importOriginal<typeof clackPrompts>()),
  confirm: prompt.confirm,
  isCancel: (value: unknown) => value === prompt.cancel,
}));

const execFileAsync = promisify(execFile);

const GIT_ROUTING_ENVIRONMENT = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_COMMON_DIR",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
] as const;
const GIT_ENVIRONMENT = [
  ...GIT_ROUTING_ENVIRONMENT,
  "GIT_CONFIG_COUNT",
  "GIT_CONFIG_GLOBAL",
  "GIT_CONFIG_KEY_0",
  "GIT_CONFIG_VALUE_0",
  "GIT_SHALLOW_FILE",
  "GIT_SSH",
  "GIT_SSH_COMMAND",
  "GIT_TERMINAL_PROMPT",
] as const;

describe("gitInstallMain", () => {
  let testRoot: string;
  let target: string;
  let previousGlobalConfig: string | undefined;
  let previousGitEnvironment: Record<string, string | undefined>;
  let previousPath: string | undefined;
  let repository: Awaited<ReturnType<typeof createTestGitRepository>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    testRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nori-git-install-"));
    target = path.join(testRoot, ".nori", "profiles", "personal", "reviewer");
    previousGlobalConfig = process.env.NORI_GLOBAL_CONFIG;
    previousGitEnvironment = Object.fromEntries(
      GIT_ENVIRONMENT.map((name) => [name, process.env[name]]),
    );
    previousPath = process.env.PATH;
    process.env.NORI_GLOBAL_CONFIG = testRoot;
    repository = await createTestGitRepository({
      root: path.join(testRoot, "repository"),
    });
  });

  afterEach(async () => {
    if (previousGlobalConfig == null) {
      delete process.env.NORI_GLOBAL_CONFIG;
    } else {
      process.env.NORI_GLOBAL_CONFIG = previousGlobalConfig;
    }
    for (const name of GIT_ENVIRONMENT) {
      const previousValue = previousGitEnvironment[name];
      if (previousValue == null) {
        delete process.env[name];
      } else {
        process.env[name] = previousValue;
      }
    }
    if (previousPath == null) {
      delete process.env.PATH;
    } else {
      process.env.PATH = previousPath;
    }
    await fs.rm(testRoot, { recursive: true, force: true });
  });

  const install = (
    overrides: Partial<Parameters<typeof gitInstallMain>[0]> = {},
  ) =>
    gitInstallMain({
      slug: "reviewer",
      remote: repository.remote,
      trustSource: true,
      nonInteractive: true,
      silent: true,
      ...overrides,
    });

  const expectFailure = (
    result: Awaited<ReturnType<typeof install>>,
    error: RegExp,
  ) => {
    expect(result.success).toBe(false);
    expect(result.message).toMatch(error);
  };

  const expectRejectedCheckout = async (
    error: RegExp,
    overrides: Partial<Parameters<typeof gitInstallMain>[0]> = {},
  ) => {
    expectFailure(await install(overrides), error);
    await expect(fs.access(target)).rejects.toThrow();
  };

  const commitTrackedAlias = async (args: {
    contents: string;
    removeExactManifest?: boolean | null;
    trackedPath: string;
  }): Promise<string> => {
    const { contents, removeExactManifest, trackedPath } = args;
    const blobPath = path.join(testRoot, "tracked-alias-blob");
    const indexPath = path.join(testRoot, "tracked-alias-index");
    await fs.writeFile(blobPath, contents);
    const blob = (
      await execFileAsync("git", ["hash-object", "-w", blobPath], {
        cwd: repository.authorCheckout,
      })
    ).stdout.trim();
    const environment = { ...process.env, GIT_INDEX_FILE: indexPath };
    await execFileAsync("git", ["read-tree", "HEAD"], {
      cwd: repository.authorCheckout,
      env: environment,
    });
    if (removeExactManifest === true) {
      await execFileAsync(
        "git",
        ["update-index", "--force-remove", "nori.json"],
        {
          cwd: repository.authorCheckout,
          env: environment,
        },
      );
    }
    await execFileAsync(
      "git",
      [
        "-c",
        "core.ignorecase=false",
        "update-index",
        "--add",
        "--cacheinfo",
        `100644,${blob},${trackedPath}`,
      ],
      { cwd: repository.authorCheckout, env: environment },
    );
    const tree = (
      await execFileAsync("git", ["write-tree"], {
        cwd: repository.authorCheckout,
        env: environment,
      })
    ).stdout.trim();
    const parent = (
      await execFileAsync("git", ["rev-parse", "HEAD"], {
        cwd: repository.authorCheckout,
      })
    ).stdout.trim();
    const commit = (
      await execFileAsync(
        "git",
        ["commit-tree", tree, "-p", parent, "-m", `track ${trackedPath}`],
        { cwd: repository.authorCheckout },
      )
    ).stdout.trim();
    await execFileAsync(
      "git",
      ["update-ref", "refs/heads/skillsets/reviewer", commit],
      { cwd: repository.authorCheckout },
    );
    await execFileAsync(
      "git",
      ["push", "--force", repository.remote, "skillsets/reviewer"],
      { cwd: repository.authorCheckout },
    );
    return commit;
  };

  it("installs and activates the current tip of the derived branch", async () => {
    await repository.commit({
      slug: "reviewer",
      marker: "superseded instructions",
    });
    const expectedCommit = await repository.commit({
      slug: "reviewer",
      marker: "review instructions",
    });

    const result = await install();

    expect(result.success).toBe(true);
    const checkoutCommit = await execFileAsync("git", ["rev-parse", "HEAD"], {
      cwd: target,
    });
    expect(checkoutCommit.stdout.trim()).toBe(expectedCommit);
    const checkoutBranch = await execFileAsync(
      "git",
      ["symbolic-ref", "--short", "HEAD"],
      { cwd: target },
    );
    expect(checkoutBranch.stdout.trim()).toBe("skillsets/reviewer");
    await expect(
      fs.readFile(path.join(target, "AGENTS.md"), "utf8"),
    ).resolves.toBe("review instructions");
    const config = JSON.parse(
      await fs.readFile(path.join(testRoot, ".nori-config.json"), "utf8"),
    ) as { activeSkillset?: string };
    expect(config.activeSkillset).toBe("personal/reviewer");
    await expect(
      fs.readFile(path.join(testRoot, ".claude", "CLAUDE.md"), "utf8"),
    ).resolves.toContain("review instructions");
    await expect(
      fs.readFile(path.join(testRoot, ".claude", ".nori-managed"), "utf8"),
    ).resolves.toBe("personal/reviewer");
  });

  it("retains complete branch history for an unpinned install", async () => {
    const historicalCommit = await repository.commit({
      slug: "reviewer",
      marker: "historical instructions",
    });
    await repository.commit({
      slug: "reviewer",
      marker: "current instructions",
    });

    const result = await install();

    expect(result.success).toBe(true);
    await expect(
      execFileAsync("git", ["cat-file", "-e", `${historicalCommit}^{commit}`], {
        cwd: target,
      }),
    ).resolves.toBeDefined();
    const shallow = await execFileAsync(
      "git",
      ["rev-parse", "--is-shallow-repository"],
      { cwd: target },
    );
    expect(shallow.stdout.trim()).toBe("false");
  });

  it("resolves a relative local remote consistently", async () => {
    const expectedCommit = await repository.commit({
      slug: "reviewer",
      marker: "relative remote instructions",
    });
    const relativeRemote = path.relative(process.cwd(), repository.remote);

    const result = await install({ remote: relativeRemote });

    expect(result.success).toBe(true);
    const checkoutCommit = await execFileAsync("git", ["rev-parse", "HEAD"], {
      cwd: target,
    });
    expect(checkoutCommit.stdout.trim()).toBe(expectedCommit);
    const advertisedOrigin = await execFileAsync(
      "git",
      ["ls-remote", "--heads", "origin", "refs/heads/skillsets/reviewer"],
      { cwd: target },
    );
    expect(advertisedOrigin.stdout.trim()).toBe(
      `${expectedCommit}\trefs/heads/skillsets/reviewer`,
    );
  });

  it("checks out only the requested branch head without tags", async () => {
    const firstCommit = await repository.commit({
      slug: "reviewer",
      marker: "first version",
    });
    await execFileAsync("git", ["tag", "skillsets/reviewer", firstCommit], {
      cwd: repository.authorCheckout,
    });
    await execFileAsync(
      "git",
      ["push", repository.remote, "refs/tags/skillsets/reviewer"],
      { cwd: repository.authorCheckout },
    );
    await execFileAsync("git", ["branch", "unrelated", firstCommit], {
      cwd: repository.authorCheckout,
    });
    await execFileAsync(
      "git",
      ["push", repository.remote, "refs/heads/unrelated"],
      { cwd: repository.authorCheckout },
    );
    const branchTip = await repository.commit({
      slug: "reviewer",
      marker: "current version",
    });

    const result = await install({ remote: repository.fileRemote });

    expect(result.success).toBe(true);
    const checkoutCommit = await execFileAsync("git", ["rev-parse", "HEAD"], {
      cwd: target,
    });
    expect(checkoutCommit.stdout.trim()).toBe(branchTip);
    await expect(
      fs.readFile(path.join(target, "AGENTS.md"), "utf8"),
    ).resolves.toBe("current version");
    const tags = await execFileAsync("git", ["tag", "--list"], {
      cwd: target,
    });
    expect(tags.stdout.trim()).toBe("");
    const unrelatedBranch = await execFileAsync(
      "git",
      ["branch", "--remotes", "--list", "origin/unrelated"],
      { cwd: target },
    );
    expect(unrelatedBranch.stdout.trim()).toBe("");
  });

  it("rejects unsupported Git versions before reserving a checkout", async () => {
    const fakeBin = path.join(testRoot, "fake-bin");
    const fakeGit = path.join(fakeBin, "git");
    const invocationLog = path.join(testRoot, "git-invocations");
    await fs.mkdir(fakeBin);
    await fs.writeFile(
      fakeGit,
      `#!/bin/sh\nprintf '%s\\n' "$*" >> "${invocationLog}"\nprintf "git version 2.28.0\\n"\n`,
      { mode: 0o755 },
    );
    const previousPath = process.env.PATH;

    let result: Awaited<ReturnType<typeof install>>;
    try {
      process.env.PATH = `${fakeBin}${path.delimiter}${previousPath ?? ""}`;
      result = await install();
    } finally {
      if (previousPath == null) delete process.env.PATH;
      else process.env.PATH = previousPath;
    }

    expectFailure(result, /Git 2\.29 or newer/i);
    await expect(fs.readFile(invocationLog, "utf8")).resolves.toBe(
      "--version\n",
    );
    await expect(fs.access(target)).rejects.toThrow();
  });

  it("rejects a tag when the required branch does not exist", async () => {
    await repository.commit({ slug: "reviewer" });
    await execFileAsync("git", ["tag", "skillsets/reviewer"], {
      cwd: repository.authorCheckout,
    });
    await execFileAsync(
      "git",
      ["push", repository.remote, "refs/tags/skillsets/reviewer"],
      { cwd: repository.authorCheckout },
    );
    await execFileAsync(
      "git",
      ["push", repository.remote, ":refs/heads/skillsets/reviewer"],
      { cwd: repository.authorCheckout },
    );

    await expectRejectedCheckout(/branch.*skillsets\/reviewer.*not found/i);
  });

  it("emits no output for a successful silent install", async () => {
    await repository.commit({
      slug: "reviewer",
      manifest: {
        requiredEnv: ["NORI_GIT_INSTALL_MISSING_ENV"],
      },
      files: {
        "skills/audit/SKILL.md":
          "---\nname: audit\ndescription: Audit changes\n---\nAudit the change.\n",
        "slashcommands/check.md": "Check the current change.\n",
        "subagents/reviewer.md":
          "---\nname: reviewer\ndescription: Review changes\n---\nReview the change.\n",
      },
    });
    await fs.mkdir(path.join(testRoot, ".claude"), { recursive: true });
    await fs.writeFile(path.join(testRoot, ".claude", "settings.json"), "{}\n");
    const stdout: Array<string> = [];
    const stderr: Array<string> = [];
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(((
      chunk: string | Uint8Array,
    ): boolean => {
      stdout.push(String(chunk));
      return true;
    }) as typeof process.stdout.write);
    const stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation(((
      chunk: string | Uint8Array,
    ): boolean => {
      stderr.push(String(chunk));
      return true;
    }) as typeof process.stderr.write);

    let result;
    try {
      result = await install({ silent: true });
    } finally {
      stdoutWrite.mockRestore();
      stderrWrite.mockRestore();
    }

    expect(result?.success).toBe(true);
    expect(stdout.join("")).toBe("");
    expect(stderr.join("")).toBe("");
  });

  it("installs and activates an exact historical commit with detached HEAD", async () => {
    const historicalCommit = await repository.commit({
      slug: "reviewer",
      marker: "historical instructions",
    });
    await repository.commit({
      slug: "reviewer",
      marker: "current instructions",
    });

    const result = await install({ pin: historicalCommit });

    expect(result.success).toBe(true);
    expect(result.message).toContain(historicalCommit);
    await expect(
      fs.readFile(path.join(target, "AGENTS.md"), "utf8"),
    ).resolves.toBe("historical instructions");
    const checkoutCommit = await execFileAsync("git", ["rev-parse", "HEAD"], {
      cwd: target,
    });
    expect(checkoutCommit.stdout.trim()).toBe(historicalCommit);
    await expect(
      execFileAsync("git", ["symbolic-ref", "--quiet", "HEAD"], {
        cwd: target,
      }),
    ).rejects.toMatchObject({ code: 1 });
    await expect(
      fs.readFile(path.join(testRoot, ".claude", "CLAUDE.md"), "utf8"),
    ).resolves.toContain("historical instructions");
  });

  it("validates a pin against the branch tip actually fetched", async () => {
    const advertisedTip = await repository.commit({
      slug: "reviewer",
      marker: "advertised instructions",
    });
    const fetchedTip = await repository.commit({
      slug: "reviewer",
      marker: "fetched instructions",
    });
    await execFileAsync(
      "git",
      [
        "--git-dir",
        repository.remote,
        "update-ref",
        "refs/heads/skillsets/reviewer",
        advertisedTip,
        fetchedTip,
      ],
      { cwd: testRoot },
    );
    const realGit = (
      await execFileAsync("/bin/sh", ["-c", "command -v git"], {
        cwd: testRoot,
      })
    ).stdout.trim();
    const wrapperDir = path.join(testRoot, "moving-tip-wrapper");
    const wrapperPath = path.join(wrapperDir, "git");
    await fs.mkdir(wrapperDir);
    await fs.writeFile(
      wrapperPath,
      `#!/bin/sh
if [ "$1" = "ls-remote" ]; then
  output=$("${realGit}" "$@")
  status=$?
  if [ "$status" -eq 0 ]; then
    "${realGit}" --git-dir "${repository.remote}" update-ref refs/heads/skillsets/reviewer "${fetchedTip}" "${advertisedTip}" || exit $?
  fi
  printf '%s\\n' "$output"
  exit "$status"
fi
exec "${realGit}" "$@"
`,
      { mode: 0o755 },
    );
    process.env.PATH = `${wrapperDir}${path.delimiter}${previousPath ?? ""}`;

    const result = await install({ pin: fetchedTip });

    expect(result.success).toBe(true);
    const checkoutCommit = await execFileAsync("git", ["rev-parse", "HEAD"], {
      cwd: target,
    });
    expect(checkoutCommit.stdout.trim()).toBe(fetchedTip);
    const trackingTip = await execFileAsync(
      "git",
      ["rev-parse", "refs/remotes/origin/skillsets/reviewer"],
      { cwd: target },
    );
    expect(trackingTip.stdout.trim()).toBe(fetchedTip);
  });

  it("detaches HEAD when the requested pin is the current branch tip", async () => {
    const currentCommit = await repository.commit({ slug: "reviewer" });

    const result = await install({ pin: currentCommit });

    expect(result.success).toBe(true);
    expect(result.message).toContain(currentCommit);
    await expect(
      execFileAsync("git", ["symbolic-ref", "--quiet", "HEAD"], {
        cwd: target,
      }),
    ).rejects.toMatchObject({ code: 1 });
  });

  it.each([
    { label: "unpinned", pinned: false },
    { label: "pinned", pinned: true },
  ])(
    "rejects a tag that impersonates the required branch for a $label install",
    async ({ pinned }) => {
      const commit = await repository.commit({ slug: "reviewer" });
      await repository.replaceBranchWithTag({ slug: "reviewer" });

      await expectRejectedCheckout(/branch.*skillsets\/reviewer.*not found/i, {
        pin: pinned ? commit : null,
      });
    },
  );

  it("supports full SHA-256 commit object IDs", async () => {
    const sha256Repository = await createTestGitRepository({
      root: path.join(testRoot, "sha256-repository"),
      objectFormat: "sha256",
    });
    const historicalCommit = await sha256Repository.commit({
      slug: "reviewer",
      marker: "sha256 historical instructions",
    });
    await sha256Repository.commit({
      slug: "reviewer",
      marker: "sha256 current instructions",
    });

    const result = await install({
      remote: sha256Repository.remote,
      pin: historicalCommit,
    });

    expect(result.success).toBe(true);
    expect(result.message).toContain(historicalCommit);
    await expect(
      fs.readFile(path.join(target, "AGENTS.md"), "utf8"),
    ).resolves.toBe("sha256 historical instructions");
  });

  it("rejects a 40-character abbreviation in a SHA-256 repository", async () => {
    const sha256Repository = await createTestGitRepository({
      root: path.join(testRoot, "sha256-prefix-repository"),
      objectFormat: "sha256",
    });
    const historicalCommit = await sha256Repository.commit({
      slug: "reviewer",
      marker: "sha256 historical instructions",
    });
    await sha256Repository.commit({
      slug: "reviewer",
      marker: "sha256 current instructions",
    });

    await expectRejectedCheckout(/full.*commit.*SHA/i, {
      remote: sha256Repository.remote,
      pin: historicalCommit.slice(0, 40),
    });
  });

  it("rejects abbreviated commit object IDs", async () => {
    const commit = await repository.commit({ slug: "reviewer" });

    await expectRejectedCheckout(/full.*commit.*SHA/i, {
      pin: commit.slice(0, 12),
    });
  });

  it.each(["g".repeat(40), "HEAD", "skillsets/reviewer", "HEAD~1"])(
    "rejects non-full-SHA pin %s",
    async (pin) => {
      await repository.commit({ slug: "reviewer" });

      await expectRejectedCheckout(/full.*commit.*SHA/i, { pin });
    },
  );

  it("rejects a nonexistent full commit object ID", async () => {
    await repository.commit({ slug: "reviewer" });

    await expectRejectedCheckout(/not.*skillsets\/reviewer.*history/i, {
      pin: "0".repeat(40),
    });
  });

  it("rejects a full object ID that is not a commit", async () => {
    await repository.commit({ slug: "reviewer" });
    const blob = await execFileAsync("git", ["rev-parse", "HEAD:nori.json"], {
      cwd: repository.authorCheckout,
    });

    await expectRejectedCheckout(/does not identify a commit/i, {
      pin: blob.stdout.trim(),
    });
  });

  it("rejects a locally available commit outside the derived branch history", async () => {
    await repository.commit({ slug: "reviewer" });
    const unrelatedCommit = await repository.commitUnrelated({});
    const availabilityProbe = path.join(testRoot, "availability-probe");
    await execFileAsync(
      "git",
      [
        "clone",
        "--single-branch",
        "--branch",
        "skillsets/reviewer",
        "--no-checkout",
        "--",
        repository.remote,
        availabilityProbe,
      ],
      { cwd: testRoot },
    );
    const availableObject = await execFileAsync(
      "git",
      ["cat-file", "-t", unrelatedCommit],
      { cwd: availabilityProbe },
    );
    expect(availableObject.stdout.trim()).toBe("commit");

    await expectRejectedCheckout(/not.*skillsets\/reviewer.*history/i, {
      pin: unrelatedCommit,
    });
  });

  it("accepts a commit reachable through a merge's second parent", async () => {
    await repository.commit({
      slug: "reviewer",
      marker: "branch instructions",
    });
    const secondParent = await repository.mergeSecondParent({
      slug: "reviewer",
      marker: "merged instructions",
    });

    const result = await install({ pin: secondParent });

    expect(result.success).toBe(true);
    const checkoutCommit = await execFileAsync("git", ["rev-parse", "HEAD"], {
      cwd: target,
    });
    expect(checkoutCommit.stdout.trim()).toBe(secondParent);
  });

  it("rejects a pinned install from a shallow source", async () => {
    await repository.commit({ slug: "reviewer", marker: "older" });
    const currentCommit = await repository.commit({
      slug: "reviewer",
      marker: "current",
    });
    const shallowRemote = await repository.createShallowRemote({
      slug: "reviewer",
    });
    process.env.GIT_CONFIG_COUNT = "1";
    process.env.GIT_CONFIG_KEY_0 = "clone.rejectShallow";
    process.env.GIT_CONFIG_VALUE_0 = "true";

    await expectRejectedCheckout(/complete history|source is shallow/i, {
      remote: shallowRemote,
      pin: currentCommit,
    });
  });

  it("preserves an unpinned install from a shallow source", async () => {
    await repository.commit({ slug: "reviewer", marker: "older" });
    await repository.commit({
      slug: "reviewer",
      marker: "current shallow instructions",
    });
    const shallowRemote = await repository.createShallowRemote({
      slug: "reviewer",
    });
    process.env.GIT_CONFIG_COUNT = "1";
    process.env.GIT_CONFIG_KEY_0 = "clone.rejectShallow";
    process.env.GIT_CONFIG_VALUE_0 = "true";

    const result = await install({ remote: shallowRemote, pin: null });

    expect(result.success).toBe(true);
    const checkoutBranch = await execFileAsync(
      "git",
      ["symbolic-ref", "--short", "HEAD"],
      { cwd: target },
    );
    expect(checkoutBranch.stdout.trim()).toBe("skillsets/reviewer");
    await expect(
      fs.readFile(path.join(target, "AGENTS.md"), "utf8"),
    ).resolves.toBe("current shallow instructions");
    await expect(
      fs.readFile(path.join(testRoot, ".claude", "CLAUDE.md"), "utf8"),
    ).resolves.toContain("current shallow instructions");
  });

  it("ignores GIT_SHALLOW_FILE when rejecting a shallow pinned source", async () => {
    await repository.commit({ slug: "reviewer", marker: "older" });
    const currentCommit = await repository.commit({
      slug: "reviewer",
      marker: "current",
    });
    const shallowRemote = await repository.createShallowRemote({
      slug: "reviewer",
    });
    process.env.GIT_SHALLOW_FILE = path.join(testRoot, "missing-shallow-file");

    await expectRejectedCheckout(/complete history|source is shallow/i, {
      remote: shallowRemote,
      pin: currentCommit,
    });
  });

  it.each([
    {
      label: "name mismatch",
      manifest: { name: "different-name" },
      error: /manifest.*different-name.*reviewer/i,
    },
    {
      label: "type mismatch",
      manifest: { type: "skill" },
      error: /type must be skillset/i,
    },
  ])(
    "validates a historical manifest $label at the selected revision",
    async ({ manifest, error }) => {
      const invalidHistoricalCommit = await repository.commit({
        slug: "reviewer",
        marker: "invalid historical instructions",
        manifest,
      });
      await repository.commit({
        slug: "reviewer",
        marker: "valid current instructions",
      });

      await expectRejectedCheckout(error, { pin: invalidHistoricalCommit });
    },
  );

  it("rejects Registry provenance at the selected historical revision", async () => {
    const invalidHistoricalCommit = await repository.commit({
      slug: "reviewer",
      files: { ".nori-version": "https://registry.invalid\n1.0.0\n" },
    });
    await fs.rm(path.join(repository.authorCheckout, ".nori-version"));
    await repository.commit({ slug: "reviewer", marker: "valid current" });

    await expectRejectedCheckout(/Registry provenance|\.nori-version/i, {
      pin: invalidHistoricalCommit,
    });
  });

  it.each([
    { label: "unpinned", pinned: false },
    { label: "pinned", pinned: true },
  ])(
    "rejects case-folded Registry provenance for a $label install",
    async ({ pinned }) => {
      const commit = await repository.commit({
        slug: "reviewer",
        files: { ".NORI-VERSION": "https://registry.invalid\n1.0.0\n" },
      });

      await expectRejectedCheckout(/Registry provenance|\.nori-version/i, {
        pin: pinned ? commit : null,
      });
    },
  );

  it("rejects Unicode-compatible Registry provenance aliases", async () => {
    await repository.commit({
      slug: "reviewer",
      files: { ".nori-verſion": "https://registry.invalid\n1.0.0\n" },
    });

    await expectRejectedCheckout(/Registry provenance|\.nori-version/i);
  });

  it.each([
    {
      error: /Registry provenance|\.nori-version/i,
      label: "a case-folded provenance directory",
      pinned: false,
      trackedPath: ".NORI-VERSION/payload",
    },
    {
      error: /Registry provenance|\.nori-version/i,
      label: "HFS-ignored characters in provenance",
      pinned: true,
      trackedPath: ".nori-ver\u200Csion",
    },
    {
      error: null,
      label: "a case-folded manifest directory",
      pinned: false,
      trackedPath: "NORI.JSON/payload",
    },
    {
      error: null,
      label: "HFS-ignored characters in a manifest alias",
      pinned: true,
      trackedPath: "nori\u200C.json",
    },
  ])(
    "rejects $label at the tracked root boundary",
    async ({ error, pinned, trackedPath }) => {
      await repository.commit({ slug: "reviewer" });
      const commit = await commitTrackedAlias({
        contents: "reserved path payload",
        trackedPath,
      });

      const result = await install({
        pin: pinned ? commit : null,
      });
      expect(result.success).toBe(false);
      if (error != null) {
        expect(result.message).toMatch(error);
      }
      await expect(fs.access(target)).rejects.toThrow();
    },
  );

  it("requires the exact tracked nori.json path even when the filesystem resolves a case alias", async () => {
    await repository.commit({ slug: "reviewer" });
    await commitTrackedAlias({
      contents: JSON.stringify({ name: "reviewer", type: "skillset" }),
      removeExactManifest: true,
      trackedPath: "NORI.JSON",
    });
    const realGit = (
      await execFileAsync("/bin/sh", ["-c", "command -v git"], {
        cwd: testRoot,
      })
    ).stdout.trim();
    const wrapperDir = path.join(testRoot, "case-alias-wrapper");
    const wrapperPath = path.join(wrapperDir, "git");
    await fs.mkdir(wrapperDir);
    await fs.writeFile(
      wrapperPath,
      `#!/bin/sh
if [ "$1" = "ls-files" ]; then
  cp NORI.JSON nori.json
fi
exec "${realGit}" "$@"
`,
      { mode: 0o755 },
    );
    process.env.PATH = `${wrapperDir}${path.delimiter}${previousPath ?? ""}`;

    await expectRejectedCheckout(/exact.*root.*nori\.json/i);
  });

  it("rejects a root manifest alias alongside the exact nori.json", async () => {
    await repository.commit({ slug: "reviewer" });
    await commitTrackedAlias({
      contents: JSON.stringify({ name: "reviewer", type: "skillset" }),
      trackedPath: "NORI.JSON",
    });

    await expectRejectedCheckout(/exact.*root.*nori\.json/i);
  });

  it("rejects a tracked nori.json symlink before reading the manifest", async () => {
    await repository.commit({ slug: "reviewer", marker: "valid base" });
    const manifestPath = path.join(repository.authorCheckout, "nori.json");
    await fs.rm(manifestPath);
    await fs.symlink("missing-manifest", manifestPath);
    await execFileAsync("git", ["add", "--all"], {
      cwd: repository.authorCheckout,
    });
    await execFileAsync("git", ["commit", "-m", "symlink manifest"], {
      cwd: repository.authorCheckout,
    });
    const invalidHistoricalCommit = await execFileAsync(
      "git",
      ["rev-parse", "HEAD"],
      { cwd: repository.authorCheckout },
    );
    await execFileAsync(
      "git",
      ["push", "--force", repository.remote, "skillsets/reviewer"],
      { cwd: repository.authorCheckout },
    );
    await fs.rm(manifestPath);
    await repository.commit({ slug: "reviewer", marker: "valid current" });

    await expectRejectedCheckout(/symbolic links/i, {
      pin: invalidHistoricalCommit.stdout.trim(),
    });
  });

  it("rejects a symbolic link at the selected historical revision", async () => {
    await fs.symlink(
      "AGENTS.md",
      path.join(repository.authorCheckout, "linked"),
    );
    const invalidHistoricalCommit = await repository.commit({
      slug: "reviewer",
      marker: "historical with link",
    });
    await fs.rm(path.join(repository.authorCheckout, "linked"));
    await repository.commit({ slug: "reviewer", marker: "valid current" });

    await expectRejectedCheckout(/symbolic links/i, {
      pin: invalidHistoricalCommit,
    });
  });

  it("rejects a submodule at the selected historical revision", async () => {
    const baseCommit = await repository.commit({ slug: "reviewer" });
    await execFileAsync(
      "git",
      ["update-index", "--add", "--cacheinfo", `160000,${baseCommit},nested`],
      { cwd: repository.authorCheckout },
    );
    await execFileAsync("git", ["commit", "-m", "historical submodule"], {
      cwd: repository.authorCheckout,
    });
    const invalidHistoricalCommit = await execFileAsync(
      "git",
      ["rev-parse", "HEAD"],
      { cwd: repository.authorCheckout },
    );
    await execFileAsync(
      "git",
      ["push", "--force", repository.remote, "skillsets/reviewer"],
      { cwd: repository.authorCheckout },
    );
    await execFileAsync("git", ["rm", "--cached", "nested"], {
      cwd: repository.authorCheckout,
    });
    await repository.commit({ slug: "reviewer", marker: "valid current" });

    await expectRejectedCheckout(/submodules/i, {
      pin: invalidHistoricalCommit.stdout.trim(),
    });
  });

  it.each(GIT_ROUTING_ENVIRONMENT)(
    "ignores inherited %s repository routing",
    async (environmentName) => {
      const historicalCommit = await repository.commit({
        slug: "reviewer",
        marker: "historical instructions",
      });
      await repository.commit({
        slug: "reviewer",
        marker: "current instructions",
      });
      const redirectedRoot = path.join(testRoot, "redirected");
      process.env[environmentName] = path.join(
        redirectedRoot,
        environmentName.toLowerCase(),
      );

      const result = await install({ pin: historicalCommit });

      expect(result.success).toBe(true);
      await expect(
        fs.readFile(path.join(target, "AGENTS.md"), "utf8"),
      ).resolves.toBe("historical instructions");
      await expect(fs.access(redirectedRoot)).rejects.toThrow();
    },
  );

  it.each([
    {
      label: "name",
      manifest: { name: "different-name" },
      error: /manifest.*different-name.*reviewer/i,
    },
    {
      label: "type",
      manifest: { type: "skill" },
      error: /type must be skillset/i,
    },
  ])(
    "rejects a manifest with the wrong $label",
    async ({ manifest, error }) => {
      await repository.commit({
        slug: "reviewer",
        manifest,
      });

      await expectRejectedCheckout(error);
    },
  );

  it("preserves an existing destination", async () => {
    await repository.commit({ slug: "reviewer" });
    await fs.mkdir(target, { recursive: true });
    await fs.writeFile(path.join(target, "sentinel"), "keep me");

    expectFailure(await install(), /already exists/i);
    await expect(
      fs.readFile(path.join(target, "sentinel"), "utf8"),
    ).resolves.toBe("keep me");
  });

  it("rejects and sanitizes an invalid slug before prompting for trust", async () => {
    const result = await install({
      slug: "invalid\nINJECTED-OUTPUT",
      trustSource: null,
      nonInteractive: false,
      silent: false,
    });

    expectFailure(result, /lowercase letters, numbers, and hyphens only/i);
    expect(result.message).not.toContain("INJECTED-OUTPUT");
    expect(prompt.confirm).not.toHaveBeenCalled();
    await expect(fs.access(target)).rejects.toThrow();
  });

  it("requires explicit trust in non-interactive mode", async () => {
    await repository.commit({ slug: "reviewer" });

    expectFailure(await install({ trustSource: null }), /--trust-source/);
    await expect(fs.access(target)).rejects.toThrow();
  });

  it.each([
    { label: "decline", approval: false },
    { label: "cancel", approval: prompt.cancel },
  ])("treats interactive $label as cancellation", async ({ approval }) => {
    await repository.commit({ slug: "reviewer" });
    prompt.confirm.mockResolvedValueOnce(approval);

    const result = await install({
      trustSource: null,
      nonInteractive: false,
      silent: false,
    });

    expect(result).toEqual({ success: false, cancelled: true, message: "" });
    await expect(fs.access(target)).rejects.toThrow();
  });

  it("redacts credentials from URL-form remotes in the interactive trust prompt", async () => {
    prompt.confirm.mockResolvedValueOnce(false);
    const result = await install({
      remote:
        "https://credential-user-7f3:credential-password-9c2@example.invalid/skillsets.git?private_token=private-secret-a4d&X-Amz-Signature=aws-secret-b5e&sig=short-secret-c6f&oauth_token=oauth-secret-d7g&client_secret=client-secret-e8h;access%5Ftoken=encoded-secret-f9i",
      trustSource: null,
      nonInteractive: false,
      silent: false,
    });

    expect(result).toEqual({ success: false, cancelled: true, message: "" });
    const promptArgs = prompt.confirm.mock.calls[0]?.[0] as
      | { message?: string }
      | undefined;
    expect(promptArgs?.message).toContain("example.invalid/skillsets.git");
    for (const secret of [
      "credential-user-7f3",
      "credential-password-9c2",
      "private-secret-a4d",
      "aws-secret-b5e",
      "short-secret-c6f",
      "oauth-secret-d7g",
      "client-secret-e8h",
      "encoded-secret-f9i",
    ]) {
      expect(promptArgs?.message).not.toContain(secret);
    }
  });

  it("redacts common credential query parameters from Git errors", async () => {
    const missingRemote = path.join(
      testRoot,
      "missing.git?private_token=private-secret-a4d&X-Amz-Signature=aws-secret-b5e&sig=short-secret-c6f&oauth_token=oauth-secret-d7g&client_secret=client-secret-e8h",
    );
    const result = await install({
      remote: missingRemote,
    });

    expectFailure(result, /Git command failed/i);
    for (const secret of [
      "private-secret-a4d",
      "aws-secret-b5e",
      "short-secret-c6f",
      "oauth-secret-d7g",
      "client-secret-e8h",
    ]) {
      expect(result.message).not.toContain(secret);
    }
  });

  it("redacts encoded query keys and semicolon-delimited credentials from Git errors", async () => {
    const missingRemote = path.join(
      testRoot,
      "missing.git?access%5Ftoken=encoded-secret-a4d;token=semicolon-secret-b5e&client%5Fsecret=encoded-client-secret-c6f",
    );

    const result = await install({ remote: missingRemote });

    expectFailure(result, /Git command failed/i);
    for (const secret of [
      "encoded-secret-a4d",
      "semicolon-secret-b5e",
      "encoded-client-secret-c6f",
    ]) {
      expect(result.message).not.toContain(secret);
    }
  });

  it("disables Git terminal prompts for unattended installs", async () => {
    await repository.commit({ slug: "reviewer" });
    const realGit = (
      await execFileAsync("/bin/sh", ["-c", "command -v git"], {
        cwd: testRoot,
      })
    ).stdout.trim();
    const wrapperDir = path.join(testRoot, "terminal-prompt-wrapper");
    const wrapperPath = path.join(wrapperDir, "git");
    await fs.mkdir(wrapperDir);
    await fs.writeFile(
      wrapperPath,
      `#!/usr/bin/env node
const { spawnSync } = require("node:child_process");
if (process.argv[2] === "clone") {
  const challenge = spawnSync(
    ${JSON.stringify(realGit)},
    ["-c", "credential.helper=", "credential", "fill"],
    {
      encoding: "utf8",
      input: "protocol=https\\nhost=example.invalid\\n\\n",
      timeout: 3000,
      env: { ...process.env, LC_ALL: "C" },
    },
  );
  if (!challenge.stderr.includes("terminal prompts disabled")) {
    console.error("git credential challenge attempted a terminal prompt");
    process.exit(86);
  }
}
const result = spawnSync(
  ${JSON.stringify(realGit)},
  process.argv.slice(2),
  { env: process.env, stdio: "inherit" },
);
process.exit(result.status ?? 1);
`,
      { mode: 0o755 },
    );
    process.env.PATH = `${wrapperDir}${path.delimiter}${previousPath ?? ""}`;
    process.env.GIT_TERMINAL_PROMPT = "1";

    const result = await install({ nonInteractive: true, silent: false });

    expect(result.success).toBe(true);
  });

  it("uses SSH batch mode for unattended installs", async () => {
    const wrapperDir = path.join(testRoot, "ssh-batch-wrapper");
    const wrapperPath = path.join(wrapperDir, "ssh");
    const invocationPath = path.join(wrapperDir, "invocation");
    await fs.mkdir(wrapperDir);
    await fs.writeFile(
      wrapperPath,
      `#!/usr/bin/env node
const fs = require("node:fs");
fs.writeFileSync(${JSON.stringify(invocationPath)}, process.argv.slice(2).join("\\n"));
process.exit(86);
`,
      { mode: 0o755 },
    );
    process.env.PATH = `${wrapperDir}${path.delimiter}${previousPath ?? ""}`;
    process.env.GIT_SSH_COMMAND = "ssh -oConnectTimeout=7";

    const result = await install({
      remote: "ssh://git@example.invalid/skillsets.git",
      nonInteractive: true,
      silent: false,
    });

    expectFailure(result, /Git command failed/i);
    const invocation = (await fs.readFile(invocationPath, "utf8")).split("\n");
    expect(invocation).toContain("-oBatchMode=yes");
    expect(invocation).toContain("-oConnectTimeout=7");
    await expect(fs.access(target)).rejects.toThrow();
  });

  it.each([
    "ssh -oBatchMode=no -oConnectTimeout=7",
    "ssh -o 'BatchMode no' -oConnectTimeout=7",
  ])(
    "rejects an inherited SSH command that disables batch mode: %s",
    async (sshCommand) => {
      process.env.GIT_SSH_COMMAND = sshCommand;

      const result = await install({
        remote: "ssh://git@example.invalid/skillsets.git",
        nonInteractive: true,
        silent: false,
      });

      expectFailure(result, /must not disable SSH batch mode/i);
      await expect(fs.access(target)).rejects.toThrow();
    },
  );

  it("rejects an inherited SSH command before a lower-precedence GIT_SSH executable", async () => {
    const fakeBin = path.join(testRoot, "ssh-precedence-bin");
    const invocation = path.join(testRoot, "ssh-precedence-invocation");
    await fs.mkdir(fakeBin);
    await fs.writeFile(
      path.join(fakeBin, "ssh"),
      `#!/bin/sh\nprintf '%s\\n' "$*" > "${invocation}"\nexit 1\n`,
      { mode: 0o755 },
    );
    process.env.GIT_SSH = path.join(fakeBin, "lower-precedence-ssh");
    process.env.GIT_SSH_COMMAND = "ssh -oBatchMode=no";
    process.env.PATH = `${fakeBin}${path.delimiter}${previousPath ?? ""}`;

    const result = await install({
      remote: "ssh://git@example.invalid/skillsets.git",
      nonInteractive: true,
      silent: false,
    });

    expectFailure(result, /must not disable SSH batch mode/i);
    await expect(fs.access(invocation)).rejects.toThrow();
    await expect(fs.access(target)).rejects.toThrow();
  });

  it("rejects a global core.sshCommand that disables batch mode", async () => {
    const fakeBin = path.join(testRoot, "configured-ssh-bin");
    const invocation = path.join(testRoot, "configured-ssh-invocation");
    const globalConfig = path.join(testRoot, "configured-ssh.gitconfig");
    await fs.mkdir(fakeBin);
    await fs.writeFile(
      path.join(fakeBin, "ssh"),
      `#!/bin/sh\nprintf '%s\\n' "$*" > "${invocation}"\nexit 1\n`,
      { mode: 0o755 },
    );
    await execFileAsync(
      "git",
      [
        "config",
        "--file",
        globalConfig,
        "core.sshCommand",
        "ssh -oBatchMode=no -oConnectTimeout=7",
      ],
      { cwd: testRoot },
    );
    process.env.GIT_CONFIG_GLOBAL = globalConfig;
    delete process.env.GIT_SSH;
    delete process.env.GIT_SSH_COMMAND;
    process.env.PATH = `${fakeBin}${path.delimiter}${previousPath ?? ""}`;

    const result = await install({
      remote: "ssh://git@example.invalid/skillsets.git",
      nonInteractive: true,
      silent: false,
    });

    expectFailure(result, /must not disable SSH batch mode/i);
    await expect(fs.access(invocation)).rejects.toThrow();
    await expect(fs.access(target)).rejects.toThrow();
  });

  it("preserves unexpected Git object inspection errors", async () => {
    const historicalCommit = await repository.commit({ slug: "reviewer" });
    await repository.commit({ slug: "reviewer", marker: "current" });
    const realGit = (
      await execFileAsync("/bin/sh", ["-c", "command -v git"], {
        cwd: testRoot,
      })
    ).stdout.trim();
    const wrapperDir = path.join(testRoot, "git-wrapper");
    const wrapperPath = path.join(wrapperDir, "git");
    await fs.mkdir(wrapperDir);
    await fs.writeFile(
      wrapperPath,
      `#!/bin/sh\nif [ "$1" = "cat-file" ]; then\n  echo "simulated object database failure" >&2\n  exit 128\nfi\nexec "${realGit}" "$@"\n`,
      { mode: 0o755 },
    );
    process.env.PATH = `${wrapperDir}${path.delimiter}${previousPath ?? ""}`;

    await expectRejectedCheckout(/simulated object database failure/i, {
      pin: historicalCommit,
    });
  });

  it("closes stdin for Git commands that do not consume input", async () => {
    await repository.commit({ slug: "reviewer" });
    const realGit = (
      await execFileAsync("/bin/sh", ["-c", "command -v git"], {
        cwd: testRoot,
      })
    ).stdout.trim();
    const wrapperDir = path.join(testRoot, "stdin-wrapper");
    const wrapperPath = path.join(wrapperDir, "git");
    const invocationSentinel = path.join(wrapperDir, "invoked");
    await fs.mkdir(wrapperDir);
    await fs.writeFile(
      wrapperPath,
      `#!/usr/bin/env node
const { spawnSync } = require("node:child_process");
const { writeFileSync } = require("node:fs");
writeFileSync(${JSON.stringify(invocationSentinel)}, "invoked");
const timer = setTimeout(() => {
  console.error("git stdin remained open");
  process.exit(86);
}, 3000);
process.stdin.resume();
process.stdin.on("end", () => {
  clearTimeout(timer);
  const result = spawnSync(${JSON.stringify(realGit)}, process.argv.slice(2), {
    stdio: ["ignore", "inherit", "inherit"],
  });
  process.exit(result.status ?? 1);
});
`,
      { mode: 0o755 },
    );
    process.env.PATH = `${wrapperDir}${path.delimiter}${previousPath ?? ""}`;

    const result = await install();

    expect(result.success).toBe(true);
    await expect(fs.readFile(invocationSentinel, "utf8")).resolves.toBe(
      "invoked",
    );
  });

  it("installs after interactive approval", async () => {
    await repository.commit({ slug: "reviewer" });
    prompt.confirm.mockResolvedValueOnce(true);

    const result = await install({
      trustSource: null,
      nonInteractive: false,
      silent: false,
    });

    expect(result.success).toBe(true);
    expect(prompt.confirm).toHaveBeenCalledTimes(1);
  });

  it("redacts credentials from the interactive trust prompt", async () => {
    const remote =
      "https://user:SECRET_PASSWORD@example.invalid/repository.git?private_token=SECRET_QUERY#SECRET_FRAGMENT";
    prompt.confirm.mockResolvedValueOnce(false);

    await install({
      remote,
      trustSource: null,
      nonInteractive: false,
      silent: false,
    });

    const promptArgs = prompt.confirm.mock.calls[0]?.[0] as { message: string };
    expect(promptArgs.message).not.toContain("SECRET_PASSWORD");
    expect(promptArgs.message).not.toContain("SECRET_QUERY");
    expect(promptArgs.message).not.toContain("SECRET_FRAGMENT");
    expect(promptArgs.message).toContain("example.invalid/repository.git");
  });

  it("redacts the user component of an SCP-style remote from the trust prompt", async () => {
    const remote = "SECRET_SCP_USER@example.invalid:repository.git";
    prompt.confirm.mockResolvedValueOnce(false);

    await install({
      remote,
      trustSource: null,
      nonInteractive: false,
      silent: false,
    });

    const promptArgs = prompt.confirm.mock.calls[0]?.[0] as { message: string };
    expect(promptArgs.message).not.toContain("SECRET_SCP_USER");
    expect(promptArgs.message).toContain("***@example.invalid");
  });

  it.each(["http", "1foo"])(
    "rejects %s remote-helper syntax without exposing embedded credentials",
    async (transport) => {
      const secret = "SECRET_REMOTE_HELPER_CREDENTIAL";

      const result = await install({
        remote: `${transport}::https://user:${secret}@example.invalid/repository.git`,
        trustSource: null,
        nonInteractive: false,
        silent: false,
      });

      expectFailure(result, /remote-helper.*not supported/i);
      expect(result.message).not.toContain(secret);
      expect(prompt.confirm).not.toHaveBeenCalled();
      await expect(fs.access(target)).rejects.toThrow();
    },
  );

  it.each(["ftp", "unknown", "foo+bar", "1foo"])(
    "rejects unsupported %s URL schemes before source approval",
    async (scheme) => {
      const result = await install({
        remote: `${scheme}://example.invalid/repository.git`,
        trustSource: null,
        nonInteractive: false,
        silent: false,
      });

      expectFailure(result, /unsupported Git remote scheme/i);
      expect(prompt.confirm).not.toHaveBeenCalled();
      await expect(fs.access(target)).rejects.toThrow();
    },
  );

  it("sanitizes controls in a rejected remote scheme", async () => {
    const result = await install({
      remote:
        "bad\u0000\n\u001b[31m\u007f\u0085\u009bVISIBLE://example.invalid/repository.git",
      trustSource: null,
      nonInteractive: false,
      silent: false,
    });

    expectFailure(result, /unsupported Git remote scheme/i);
    expect(result.message).toMatch(/visible/i);
    expect(result.message).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/u);
    expect(prompt.confirm).not.toHaveBeenCalled();
  });

  it.each([
    "HTTP://example.invalid/repository.git",
    "https://example.invalid/repository.git",
    "ssh://example.invalid/repository.git",
    "git://example.invalid/repository.git",
    "git+ssh://example.invalid/repository.git",
    "file:///tmp/repository.git",
    "git@example.invalid:repository.git",
  ])(
    "allows the supported remote form %s to reach source approval",
    async (remote) => {
      const result = await install({
        remote,
        trustSource: null,
        nonInteractive: false,
        silent: false,
      });

      expect(result.cancelled).toBe(true);
      expect(prompt.confirm).toHaveBeenCalledTimes(1);
      await expect(fs.access(target)).rejects.toThrow();
    },
  );

  it("does not retain credentials from a successful remote", async () => {
    await repository.commit({ slug: "reviewer" });
    const secret = "SECRET_REMOTE_CREDENTIAL";
    const remote = `file://user:${secret}@localhost${repository.remote}`;

    const result = await install({ remote });

    expect(result.success).toBe(true);
    const origin = await execFileAsync(
      "git",
      ["config", "--get", "remote.origin.url"],
      { cwd: target },
    );
    expect(origin.stdout).not.toContain(secret);
    expect(origin.stdout.trim()).toBe(repository.fileRemote);
    const upstream = await execFileAsync(
      "git",
      ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
      { cwd: target },
    );
    expect(upstream.stdout.trim()).toBe("origin/skillsets/reviewer");
    const gitFiles = await fs.readdir(path.join(target, ".git"), {
      recursive: true,
    });
    for (const relativePath of gitFiles) {
      const filePath = path.join(target, ".git", relativePath);
      const stat = await fs.lstat(filePath);
      if (!stat.isFile()) continue;
      const content = await fs.readFile(filePath);
      expect(content.includes(Buffer.from(secret))).toBe(false);
    }
  });

  it("redacts arbitrary query credentials from Git failures", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(500);
      response.end();
    });
    let result: Awaited<ReturnType<typeof install>>;

    try {
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      );
      const address = server.address() as AddressInfo;
      result = await install({
        remote: `http://127.0.0.1:${address.port}/repository.git?private_token=SECRET_QUERY&sig=SECRET_SIGNATURE`,
      });
    } finally {
      if (server.listening) {
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error == null ? resolve() : reject(error))),
        );
      }
    }

    expect(result.success).toBe(false);
    expect(result.message).not.toContain("SECRET_QUERY");
    expect(result.message).not.toContain("SECRET_SIGNATURE");
  });

  it("does not invoke HTTP askpass in non-interactive mode", async () => {
    await repository.commit({ slug: "reviewer" });
    const askpassMarker = path.join(testRoot, "askpass-invoked");
    const askpass = path.join(testRoot, "askpass.sh");
    await fs.writeFile(
      askpass,
      `#!/bin/sh\nprintf invoked > "${askpassMarker}"\nprintf credential\n`,
      { mode: 0o755 },
    );
    const previousEnvironment = {
      GIT_ASKPASS: process.env.GIT_ASKPASS,
      GIT_TERMINAL_PROMPT: process.env.GIT_TERMINAL_PROMPT,
      GCM_INTERACTIVE: process.env.GCM_INTERACTIVE,
    };
    const server = createServer((_request, response) => {
      response.writeHead(401, { "WWW-Authenticate": 'Basic realm="test"' });
      response.end();
    });

    try {
      process.env.GIT_ASKPASS = askpass;
      process.env.GIT_TERMINAL_PROMPT = "1";
      process.env.GCM_INTERACTIVE = "Always";
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      );
      const address = server.address() as AddressInfo;
      const result = await install({
        remote: `http://127.0.0.1:${address.port}/repository.git`,
      });

      expect(result.success).toBe(false);
      await expect(fs.access(askpassMarker)).rejects.toThrow();
    } finally {
      for (const [name, value] of Object.entries(previousEnvironment)) {
        if (value == null) delete process.env[name];
        else process.env[name] = value;
      }
      if (server.listening) {
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error == null ? resolve() : reject(error))),
        );
      }
    }
  });

  it.each(["environment", "Git config"])(
    "preserves a custom SSH command from %s",
    async (source) => {
      const marker = path.join(testRoot, "ssh-command-args");
      const sshCommand = path.join(testRoot, "custom-ssh.sh");
      await fs.writeFile(
        sshCommand,
        `#!/bin/sh\nprintf '%s\\n' "$*" > "${marker}"\nexit 1\n`,
        { mode: 0o755 },
      );
      const previousEnvironment = {
        GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND,
        GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL,
      };

      try {
        if (source === "environment") {
          process.env.GIT_SSH_COMMAND = `${sshCommand} --sentinel-option`;
        } else {
          delete process.env.GIT_SSH_COMMAND;
          const globalConfig = path.join(testRoot, "gitconfig");
          process.env.GIT_CONFIG_GLOBAL = globalConfig;
          await execFileAsync(
            "git",
            [
              "config",
              "--file",
              globalConfig,
              "core.sshCommand",
              `${sshCommand} --sentinel-option`,
            ],
            { cwd: testRoot },
          );
        }

        const result = await install({
          remote: "ssh://example.invalid/repository.git",
        });
        expect(result.success).toBe(false);
        const args = await fs.readFile(marker, "utf8");
        expect(args).toContain("--sentinel-option");
        expect(args).not.toContain("BatchMode");
      } finally {
        for (const [name, value] of Object.entries(previousEnvironment)) {
          if (value == null) delete process.env[name];
          else process.env[name] = value;
        }
      }
    },
  );

  it("uses OpenSSH batch mode by default in non-interactive mode", async () => {
    const fakeBin = path.join(testRoot, "fake-ssh-bin");
    const marker = path.join(testRoot, "default-ssh-args");
    await fs.mkdir(fakeBin);
    await fs.writeFile(
      path.join(fakeBin, "ssh"),
      `#!/bin/sh\nprintf '%s\\n' "$*" > "${marker}"\nexit 1\n`,
      { mode: 0o755 },
    );
    const previousEnvironment = {
      GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL,
      GIT_SSH: process.env.GIT_SSH,
      GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND,
      PATH: process.env.PATH,
    };

    try {
      process.env.GIT_CONFIG_GLOBAL = path.join(testRoot, "empty-gitconfig");
      delete process.env.GIT_SSH;
      delete process.env.GIT_SSH_COMMAND;
      process.env.PATH = `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}`;

      const result = await install({
        remote: "ssh://example.invalid/repository.git",
      });

      expect(result.success).toBe(false);
      const args = await fs.readFile(marker, "utf8");
      expect(args).toContain("BatchMode=yes");
      expect(args).toContain("example.invalid");
    } finally {
      for (const [name, value] of Object.entries(previousEnvironment)) {
        if (value == null) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });

  it("preserves a custom SSH executable from GIT_SSH", async () => {
    const marker = path.join(testRoot, "git-ssh-args");
    const sshExecutable = path.join(testRoot, "custom-git-ssh.sh");
    await fs.writeFile(
      sshExecutable,
      `#!/bin/sh\nprintf '%s\\n' "$*" > "${marker}"\nexit 1\n`,
      { mode: 0o755 },
    );
    const previousEnvironment = {
      GIT_SSH: process.env.GIT_SSH,
      GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND,
      GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL,
    };

    try {
      process.env.GIT_SSH = sshExecutable;
      delete process.env.GIT_SSH_COMMAND;
      process.env.GIT_CONFIG_GLOBAL = path.join(testRoot, "empty-gitconfig");

      const result = await install({
        remote: "ssh://example.invalid/repository.git",
      });

      expect(result.success).toBe(false);
      const args = await fs.readFile(marker, "utf8");
      expect(args).toContain("example.invalid");
      expect(args).not.toContain("BatchMode");
    } finally {
      for (const [name, value] of Object.entries(previousEnvironment)) {
        if (value == null) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });

  it("removes terminal control characters from Git failures", async () => {
    const sshExecutable = path.join(testRoot, "control-output-ssh.sh");
    await fs.writeFile(
      sshExecutable,
      "#!/bin/sh\nprintf '\\033[31mREMOTE-CONTROL\\033[0m\\n' >&2\nexit 1\n",
      { mode: 0o755 },
    );
    const previousEnvironment = {
      GIT_SSH: process.env.GIT_SSH,
      GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND,
    };

    try {
      process.env.GIT_SSH = sshExecutable;
      delete process.env.GIT_SSH_COMMAND;

      const result = await install({
        remote: "ssh://example.invalid/repository.git",
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain("REMOTE-CONTROL");
      expect(result.message).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/u);
    } finally {
      for (const [name, value] of Object.entries(previousEnvironment)) {
        if (value == null) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });

  it("redacts the user component of an SCP-style remote from Git failures", async () => {
    const sshExecutable = path.join(testRoot, "echo-args-ssh.sh");
    await fs.writeFile(
      sshExecutable,
      "#!/bin/sh\nprintf '%s\\n' \"$*\" >&2\nexit 1\n",
      { mode: 0o755 },
    );
    const previousEnvironment = {
      GIT_SSH: process.env.GIT_SSH,
      GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND,
    };

    try {
      process.env.GIT_SSH = sshExecutable;
      delete process.env.GIT_SSH_COMMAND;

      const result = await install({
        remote: "SECRET_SCP_USER@example.invalid:repository.git",
      });

      expect(result.success).toBe(false);
      expect(result.message).not.toContain("SECRET_SCP_USER");
      expect(result.message).toContain("***@example.invalid");
    } finally {
      for (const [name, value] of Object.entries(previousEnvironment)) {
        if (value == null) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });

  it("suppresses all visible output in silent mode", async () => {
    await repository.commit({ slug: "reviewer" });
    const output: Array<string> = [];
    const consoleLog = vi
      .spyOn(console, "log")
      .mockImplementation((...args) => {
        output.push(args.join(" "));
      });
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(((
      chunk: unknown,
    ) => {
      output.push(String(chunk));
      return true;
    }) as typeof process.stdout.write);
    const stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation(((
      chunk: unknown,
    ) => {
      output.push(String(chunk));
      return true;
    }) as typeof process.stderr.write);

    try {
      const result = await install({ silent: true });
      expect(result.success).toBe(true);
    } finally {
      consoleLog.mockRestore();
      stdoutWrite.mockRestore();
      stderrWrite.mockRestore();
    }
    expect(output).toEqual([]);
  });

  it("shows installation completion after a successful global commit", async () => {
    await repository.commit({ slug: "reviewer" });
    const output: Array<string> = [];
    const consoleLog = vi
      .spyOn(console, "log")
      .mockImplementation((...args) => {
        output.push(args.join(" "));
      });
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(((
      chunk: unknown,
    ) => {
      output.push(String(chunk));
      return true;
    }) as typeof process.stdout.write);
    const stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation(((
      chunk: unknown,
    ) => {
      output.push(String(chunk));
      return true;
    }) as typeof process.stderr.write);

    let result: Awaited<ReturnType<typeof install>>;
    try {
      result = await install({ silent: false });
    } finally {
      consoleLog.mockRestore();
      stdoutWrite.mockRestore();
      stderrWrite.mockRestore();
    }

    expect(result.success).toBe(true);
    const config = JSON.parse(
      await fs.readFile(path.join(testRoot, ".nori-config.json"), "utf8"),
    ) as { activeSkillset?: string | null };
    expect(config.activeSkillset).toBe("personal/reviewer");
    expect(output.join("")).toContain("Installation Complete");
  });

  it("rejects Registry provenance", async () => {
    await repository.commit({
      slug: "reviewer",
      files: { ".nori-version": "https://registry.example.invalid\n1.0.0\n" },
    });

    await expectRejectedCheckout(/Registry provenance|\.nori-version/i);
  });

  it("rejects mixed-case Registry provenance", async () => {
    await repository.commit({
      slug: "reviewer",
      files: {
        ".nOrI-vErSiOn": "https://registry.example.invalid\n1.0.0\n",
      },
    });

    await expectRejectedCheckout(/Registry provenance|\.nori-version/i);
  });

  it("removes terminal control characters from manifest validation errors", async () => {
    await repository.commit({
      slug: "reviewer",
      manifest: {
        name: "REMOTE\u0000\n\u001b[31m\u007f\u0085\u009b-CONTROL",
      },
    });

    const result = await install();

    expectFailure(result, /does not match requested name/i);
    expect(result.message).toContain("REMOTE");
    expect(result.message).toContain("-CONTROL");
    expect(result.message).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/u);
  });

  it("removes terminal control characters from malformed manifest errors", async () => {
    await repository.commit({
      slug: "reviewer",
      files: { "nori.json": "\u001b[31mnot-json" },
    });

    const result = await install();

    expectFailure(result, /invalid skillset manifest/i);
    expect(result.message).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/u);
  });

  it("rejects symbolic links", async () => {
    await fs.symlink(
      "AGENTS.md",
      path.join(repository.authorCheckout, "linked"),
    );
    await repository.commit({ slug: "reviewer" });

    await expectRejectedCheckout(/symbolic links/i);
  });

  it("rejects a symbolic-link manifest before reading its target", async () => {
    const sentinel = "LOCAL_SECRET_MUST_NOT_BE_READ";
    const outsideManifest = path.join(testRoot, "outside.json");
    await fs.writeFile(
      outsideManifest,
      JSON.stringify({ name: sentinel, version: "1.0.0", type: "skillset" }),
    );
    await repository.commit({ slug: "reviewer" });
    const manifestPath = path.join(repository.authorCheckout, "nori.json");
    await fs.rm(manifestPath);
    await fs.symlink(outsideManifest, manifestPath);
    await execFileAsync("git", ["add", "-A"], {
      cwd: repository.authorCheckout,
    });
    await execFileAsync("git", ["commit", "-m", "symlink manifest"], {
      cwd: repository.authorCheckout,
    });
    await execFileAsync(
      "git",
      ["push", "--force", repository.remote, "skillsets/reviewer"],
      { cwd: repository.authorCheckout },
    );

    const result = await install();

    expectFailure(result, /symbolic links/i);
    expect(result.message).not.toContain(sentinel);
    await expect(fs.access(target)).rejects.toThrow();
  });

  it("rejects submodules", async () => {
    const commit = await repository.commit({ slug: "reviewer" });
    await execFileAsync(
      "git",
      ["update-index", "--add", "--cacheinfo", `160000,${commit},nested`],
      { cwd: repository.authorCheckout },
    );
    await execFileAsync("git", ["commit", "-m", "add gitlink"], {
      cwd: repository.authorCheckout,
    });
    await execFileAsync(
      "git",
      ["push", "--force", repository.remote, "skillsets/reviewer"],
      { cwd: repository.authorCheckout },
    );

    await expectRejectedCheckout(/submodules/i);
  });

  it("retains a validated checkout and stable config after activation fails", async () => {
    await updateConfig({ defaultAgents: ["claude-code"] });
    await repository.commit({
      slug: "reviewer",
      files: {
        "mcp/test.json": JSON.stringify({
          name: "test",
          transport: "stdio",
          command: "test-command",
          scope: "user",
        }),
      },
    });
    await fs.writeFile(
      path.join(testRoot, ".claude.json"),
      "\u001b[31mnot valid json",
    );

    const scopedInstallDir = path.join(
      testRoot,
      "project $HOME `ignored-command` 'quoted'",
    );
    const result = await install({ installDir: scopedInstallDir });

    expectFailure(result, /activation.*incomplete|checkout.*retained/i);
    expect(result.message).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/u);
    await expect(fs.access(target)).resolves.toBe(undefined);
    const config = JSON.parse(
      await fs.readFile(path.join(testRoot, ".nori-config.json"), "utf8"),
    ) as { activeSkillset?: string | null };
    expect(config.activeSkillset ?? null).toBe(null);
    await expect(
      fs.access(path.join(scopedInstallDir, ".claude", ".nori-managed")),
    ).rejects.toThrow();
    const recoveryCommand = result.message.match(
      /then run: (sks [\s\S]+?)\. /u,
    )?.[1];
    expect(recoveryCommand).toBeDefined();
    const stubBin = path.join(testRoot, "stub-bin");
    const recoveryArgs = path.join(testRoot, "recovery-args");
    await fs.mkdir(stubBin);
    await fs.writeFile(
      path.join(stubBin, "sks"),
      '#!/bin/sh\nprintf "%s\\n" "$@" > "$RECOVERY_ARGS"\n',
      { mode: 0o755 },
    );
    await execFileAsync("sh", ["-c", recoveryCommand!], {
      env: {
        ...process.env,
        PATH: `${stubBin}${path.delimiter}${process.env.PATH ?? ""}`,
        RECOVERY_ARGS: recoveryArgs,
      },
    });
    await expect(fs.readFile(recoveryArgs, "utf8")).resolves.toBe(
      [
        "--install-dir",
        scopedInstallDir,
        "--agent",
        "claude-code",
        "switch",
        "personal/reviewer",
        "--force",
        "",
      ].join("\n"),
    );
  });

  it("preserves the previous global skillset when activation fails", async () => {
    await updateConfig({
      activeSkillset: "personal/previous",
      defaultAgents: ["claude-code"],
    });
    await repository.commit({
      slug: "reviewer",
      files: {
        "mcp/test.json": JSON.stringify({
          name: "test",
          transport: "stdio",
          command: "test-command",
          scope: "user",
        }),
      },
    });
    await fs.writeFile(path.join(testRoot, ".claude.json"), "not valid json");

    const result = await install();

    expectFailure(result, /activation.*incomplete|checkout.*retained/i);
    const config = JSON.parse(
      await fs.readFile(path.join(testRoot, ".nori-config.json"), "utf8"),
    ) as { activeSkillset?: string | null };
    expect(config.activeSkillset).toBe("personal/previous");
  });

  it("preserves the previous global skillset when a later agent fails", async () => {
    await updateConfig({
      activeSkillset: "personal/previous",
      defaultAgents: ["claude-code", "codex"],
    });
    await repository.commit({
      slug: "reviewer",
      files: {
        "mcp/test.json": JSON.stringify({
          name: "test",
          transport: "stdio",
          command: "test-command",
          scope: "user",
        }),
      },
    });
    await fs.mkdir(path.join(testRoot, ".claude"), { recursive: true });
    await fs.mkdir(path.join(testRoot, ".codex"), { recursive: true });
    await fs.writeFile(
      path.join(testRoot, ".claude", ".nori-managed"),
      "personal/previous",
    );
    await fs.writeFile(
      path.join(testRoot, ".codex", ".nori-managed"),
      "personal/previous",
    );
    await fs.mkdir(path.join(testRoot, ".codex", "config.toml"), {
      recursive: true,
    });

    const result = await install();

    expectFailure(result, /activation.*incomplete|checkout.*retained/i);
    await expect(
      fs.readFile(path.join(testRoot, ".claude", "CLAUDE.md"), "utf8"),
    ).resolves.toContain("test skillset");
    const config = JSON.parse(
      await fs.readFile(path.join(testRoot, ".nori-config.json"), "utf8"),
    ) as { activeSkillset?: string | null };
    expect(config.activeSkillset).toBe("personal/previous");
    await expect(
      fs.readFile(path.join(testRoot, ".claude", ".nori-managed"), "utf8"),
    ).resolves.toBe("personal/reviewer");
    await expect(
      fs.readFile(path.join(testRoot, ".codex", ".nori-managed"), "utf8"),
    ).resolves.toBe("personal/previous");
  });

  it("keeps a successful explicit install directory transient", async () => {
    await updateConfig({
      activeSkillset: "personal/previous",
      defaultAgents: ["claude-code"],
    });
    await repository.commit({
      slug: "reviewer",
      marker: "scoped instructions",
    });
    const scopedInstallDir = path.join(testRoot, "scoped-project");
    const output: Array<string> = [];
    const consoleLog = vi
      .spyOn(console, "log")
      .mockImplementation((...args) => {
        output.push(args.join(" "));
      });
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(((
      chunk: unknown,
    ) => {
      output.push(String(chunk));
      return true;
    }) as typeof process.stdout.write);
    const stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation(((
      chunk: unknown,
    ) => {
      output.push(String(chunk));
      return true;
    }) as typeof process.stderr.write);

    let result: Awaited<ReturnType<typeof install>>;
    try {
      result = await install({
        installDir: scopedInstallDir,
        silent: false,
      });
    } finally {
      consoleLog.mockRestore();
      stdoutWrite.mockRestore();
      stderrWrite.mockRestore();
    }

    expect(result.success).toBe(true);
    await expect(
      fs.readFile(path.join(scopedInstallDir, ".claude", "CLAUDE.md"), "utf8"),
    ).resolves.toContain("scoped instructions");
    await expect(
      fs.readFile(
        path.join(scopedInstallDir, ".claude", ".nori-managed"),
        "utf8",
      ),
    ).resolves.toBe("personal/reviewer");
    const config = JSON.parse(
      await fs.readFile(path.join(testRoot, ".nori-config.json"), "utf8"),
    ) as { activeSkillset?: string | null };
    expect(config.activeSkillset).toBe("personal/previous");
    expect(output.join("")).toContain("Installation Complete");
  });

  it("distinguishes a final active-skillset commit failure from activation failure", async () => {
    await updateConfig({
      activeSkillset: "personal/previous",
      defaultAgents: ["claude-code"],
    });
    await repository.commit({ slug: "reviewer" });
    await fs.mkdir(path.join(testRoot, ".claude"), { recursive: true });
    await fs.writeFile(
      path.join(testRoot, ".claude", ".nori-managed"),
      "personal/previous",
    );
    const writeJsonFileAtomic = jsonFile.writeJsonFileAtomic;
    const writeSpy = vi
      .spyOn(jsonFile, "writeJsonFileAtomic")
      .mockImplementation(async (args) => {
        const value = args.value as { activeSkillset?: string | null };
        const activationCompleted = await fs
          .access(path.join(testRoot, ".claude", "CLAUDE.md"))
          .then(
            () => true,
            () => false,
          );
        if (
          value.activeSkillset === "personal/reviewer" &&
          activationCompleted
        ) {
          throw new Error("config commit failed");
        }
        await writeJsonFileAtomic(args);
      });
    const output: Array<string> = [];
    const consoleLog = vi
      .spyOn(console, "log")
      .mockImplementation((...args) => {
        output.push(args.join(" "));
      });
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(((
      chunk: unknown,
    ) => {
      output.push(String(chunk));
      return true;
    }) as typeof process.stdout.write);
    const stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation(((
      chunk: unknown,
    ) => {
      output.push(String(chunk));
      return true;
    }) as typeof process.stderr.write);

    let result: Awaited<ReturnType<typeof install>>;
    try {
      result = await install({ silent: false });
    } finally {
      writeSpy.mockRestore();
      consoleLog.mockRestore();
      stdoutWrite.mockRestore();
      stderrWrite.mockRestore();
    }

    expectFailure(result, /activation completed.*active skillset/i);
    expect(result.message).toContain("config commit failed");
    expect(output.join("")).not.toContain("Installation Complete");
    await expect(
      fs.readFile(path.join(testRoot, ".claude", "CLAUDE.md"), "utf8"),
    ).resolves.toContain("test skillset");
    const config = JSON.parse(
      await fs.readFile(path.join(testRoot, ".nori-config.json"), "utf8"),
    ) as { activeSkillset?: string | null };
    expect(config.activeSkillset).toBe("personal/previous");
    await expect(
      fs.readFile(path.join(testRoot, ".claude", ".nori-managed"), "utf8"),
    ).resolves.toBe("personal/reviewer");
  });

  it("rejects an unknown agent before reserving a checkout", async () => {
    await updateConfig({ defaultAgents: ["unknown-agent"] });
    await repository.commit({ slug: "reviewer" });

    const result = await install({
      remote: path.join(testRoot, "missing-remote.git"),
    });

    expectFailure(result, /unknown agent/i);
    await expect(fs.access(target)).rejects.toThrow();
  });
});
