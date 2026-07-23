import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as clackPrompts from "@clack/prompts";

import { gitInstallMain } from "./gitInstall.js";
import { createTestGitRepository } from "../../../../tests/helpers/gitRepository.js";

const prompt = vi.hoisted(() => ({ confirm: vi.fn() }));

vi.mock("@clack/prompts", async (importOriginal) => ({
  ...(await importOriginal<typeof clackPrompts>()),
  confirm: prompt.confirm,
  isCancel: (value: unknown) => typeof value === "symbol",
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
  "GIT_SHALLOW_FILE",
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

  it("requires explicit trust in non-interactive mode", async () => {
    await repository.commit({ slug: "reviewer" });

    expectFailure(await install({ trustSource: null }), /--trust-source/);
    await expect(fs.access(target)).rejects.toThrow();
  });

  it("redacts credentials from URL-form remotes in the interactive trust prompt", async () => {
    prompt.confirm.mockResolvedValueOnce(false);
    const result = await install({
      remote:
        "FtPs://credential-user-7f3:credential-password-9c2@example.invalid/skillsets.git?private_token=private-secret-a4d&X-Amz-Signature=aws-secret-b5e&sig=short-secret-c6f&oauth_token=oauth-secret-d7g&client_secret=client-secret-e8h",
      trustSource: null,
      nonInteractive: false,
      silent: false,
    });

    expectFailure(result, /not trusted/i);
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

  it("leaves no checkout after interactive decline", async () => {
    await repository.commit({ slug: "reviewer" });
    prompt.confirm.mockResolvedValueOnce(false);

    const result = await install({
      trustSource: null,
      nonInteractive: false,
      silent: false,
    });

    expectFailure(result, /not trusted/i);
    await expect(fs.access(target)).rejects.toThrow();
  });

  it("rejects Registry provenance", async () => {
    await repository.commit({
      slug: "reviewer",
      files: { ".nori-version": "https://registry.example.invalid\n1.0.0\n" },
    });

    await expectRejectedCheckout(/Registry provenance|\.nori-version/i);
  });

  it("rejects symbolic links", async () => {
    await fs.symlink(
      "AGENTS.md",
      path.join(repository.authorCheckout, "linked"),
    );
    await repository.commit({ slug: "reviewer" });

    await expectRejectedCheckout(/symbolic links/i);
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
});
