import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as clackPrompts from "@clack/prompts";

import { acquireGitSkillset, gitInstallMain } from "./gitInstall.js";
import { createTestGitRepository } from "../../../../tests/helpers/gitRepository.js";

const prompt = vi.hoisted(() => ({
  confirm: vi.fn(),
}));

vi.mock("@clack/prompts", async (importOriginal) => {
  const actual = await importOriginal<typeof clackPrompts>();
  return {
    ...actual,
    confirm: prompt.confirm,
    isCancel: (value: unknown) => typeof value === "symbol",
  };
});

const execFileAsync = promisify(execFile);

describe("acquireGitSkillset", () => {
  let testRoot: string;
  let profilesDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    testRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nori-git-install-"));
    profilesDir = path.join(testRoot, "profiles");
  });

  afterEach(async () => {
    await fs.rm(testRoot, { recursive: true, force: true });
  });

  it("installs the named skillset from its derived branch", async () => {
    const repository = await createTestGitRepository({ root: testRoot });
    await repository.commit({
      slug: "reviewer",
      marker: "first revision",
    });
    const expectedCommit = await repository.commit({
      slug: "reviewer",
      marker: "current revision",
    });

    const result = await acquireGitSkillset({
      slug: "reviewer",
      remote: repository.remote,
      profilesDir,
      trustSource: true,
      nonInteractive: true,
    });

    expect(result.identity).toBe("personal/reviewer");
    const checkoutCommit = await execFileAsync("git", ["rev-parse", "HEAD"], {
      cwd: result.checkoutDir,
    });
    expect(checkoutCommit.stdout.trim()).toBe(expectedCommit);
    const checkoutDepth = await execFileAsync(
      "git",
      ["rev-list", "--count", "HEAD"],
      { cwd: result.checkoutDir },
    );
    expect(checkoutDepth.stdout.trim()).toBe("1");
    await expect(
      fs.readFile(
        path.join(profilesDir, "personal", "reviewer", "AGENTS.md"),
        "utf8",
      ),
    ).resolves.toBe("current revision");
  });

  it("rejects a manifest whose name does not match the requested skillset without creating the target", async () => {
    const repository = await createTestGitRepository({ root: testRoot });
    await repository.commit({
      slug: "reviewer",
      manifestName: "different-name",
      marker: "mismatch",
    });

    await expect(
      acquireGitSkillset({
        slug: "reviewer",
        remote: repository.remote,
        profilesDir,
        trustSource: true,
        nonInteractive: true,
      }),
    ).rejects.toThrow(/manifest.*different-name.*reviewer/i);
    await expect(
      fs.access(path.join(profilesDir, "personal", "reviewer")),
    ).rejects.toThrow();
  });

  it("rejects a manifest whose type is not skillset without creating the target", async () => {
    const repository = await createTestGitRepository({ root: testRoot });
    await repository.commit({
      slug: "reviewer",
      marker: "wrong type",
      manifest: { type: "skill" },
    });

    await expect(
      acquireGitSkillset({
        slug: "reviewer",
        remote: repository.remote,
        profilesDir,
        trustSource: true,
        nonInteractive: true,
      }),
    ).rejects.toThrow(/type must be skillset/i);
    await expect(
      fs.access(path.join(profilesDir, "personal", "reviewer")),
    ).rejects.toThrow();
  });

  it("fails on a local-name collision without modifying the existing skillset", async () => {
    const repository = await createTestGitRepository({ root: testRoot });
    await repository.commit({ slug: "reviewer", marker: "remote content" });
    const target = path.join(profilesDir, "personal", "reviewer");
    await fs.mkdir(target, { recursive: true });
    await fs.writeFile(path.join(target, "sentinel"), "keep me");

    await expect(
      acquireGitSkillset({
        slug: "reviewer",
        remote: repository.remote,
        profilesDir,
        trustSource: true,
        nonInteractive: true,
      }),
    ).rejects.toThrow(/already exists/i);
    await expect(
      fs.readFile(path.join(target, "sentinel"), "utf8"),
    ).resolves.toBe("keep me");
  });

  it("requires an explicit trust acknowledgement in non-interactive mode", async () => {
    const repository = await createTestGitRepository({ root: testRoot });
    await repository.commit({ slug: "reviewer", marker: "untrusted" });

    await expect(
      acquireGitSkillset({
        slug: "reviewer",
        remote: repository.remote,
        profilesDir,
        nonInteractive: true,
      }),
    ).rejects.toThrow(/--trust-source/);
  });

  it("prompts once and proceeds when an interactive user trusts the source", async () => {
    const repository = await createTestGitRepository({ root: testRoot });
    await repository.commit({
      slug: "reviewer",
      marker: "trusted interactively",
    });
    prompt.confirm.mockResolvedValueOnce(true);

    await acquireGitSkillset({
      slug: "reviewer",
      remote: repository.remote,
      profilesDir,
    });

    expect(prompt.confirm).toHaveBeenCalledTimes(1);
    await expect(
      fs.readFile(
        path.join(profilesDir, "personal", "reviewer", "AGENTS.md"),
        "utf8",
      ),
    ).resolves.toBe("trusted interactively");
  });

  it("leaves no checkout when an interactive user declines trust", async () => {
    const repository = await createTestGitRepository({ root: testRoot });
    await repository.commit({ slug: "reviewer", marker: "declined" });
    prompt.confirm.mockResolvedValueOnce(false);

    await expect(
      acquireGitSkillset({
        slug: "reviewer",
        remote: repository.remote,
        profilesDir,
      }),
    ).rejects.toThrow(/not trusted/i);
    await expect(
      fs.access(path.join(profilesDir, "personal", "reviewer")),
    ).rejects.toThrow();
  });

  it("rejects Registry provenance in a Git-backed checkout", async () => {
    const repository = await createTestGitRepository({ root: testRoot });
    await repository.commit({
      slug: "reviewer",
      marker: "mixed provenance",
      files: { ".nori-version": "https://registry.example.invalid\n1.0.0\n" },
    });

    await expect(
      acquireGitSkillset({
        slug: "reviewer",
        remote: repository.remote,
        profilesDir,
        trustSource: true,
        nonInteractive: true,
      }),
    ).rejects.toThrow(/Registry provenance|\.nori-version/i);
  });

  it("rejects symbolic links", async () => {
    const repository = await createTestGitRepository({ root: testRoot });
    await fs.symlink(
      "AGENTS.md",
      path.join(repository.authorCheckout, "linked"),
    );
    await repository.commit({ slug: "reviewer", marker: "linked content" });

    await expect(
      acquireGitSkillset({
        slug: "reviewer",
        remote: repository.remote,
        profilesDir,
        trustSource: true,
        nonInteractive: true,
      }),
    ).rejects.toThrow(/symbolic links/i);
  });

  it("rejects submodules", async () => {
    const repository = await createTestGitRepository({ root: testRoot });
    const commit = await repository.commit({
      slug: "reviewer",
      marker: "base content",
    });
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

    await expect(
      acquireGitSkillset({
        slug: "reviewer",
        remote: repository.remote,
        profilesDir,
        trustSource: true,
        nonInteractive: true,
      }),
    ).rejects.toThrow(/submodules/i);
  });
});

describe("gitInstallMain", () => {
  let testRoot: string;
  let previousGlobalConfig: string | undefined;

  beforeEach(async () => {
    testRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nori-git-activate-"));
    previousGlobalConfig = process.env.NORI_GLOBAL_CONFIG;
    process.env.NORI_GLOBAL_CONFIG = testRoot;
  });

  afterEach(async () => {
    if (previousGlobalConfig == null) {
      delete process.env.NORI_GLOBAL_CONFIG;
    } else {
      process.env.NORI_GLOBAL_CONFIG = previousGlobalConfig;
    }
    await fs.rm(testRoot, { recursive: true, force: true });
  });

  it("installs and activates the acquired skillset without contacting a Registry", async () => {
    const repository = await createTestGitRepository({
      root: path.join(testRoot, "repository"),
    });
    await repository.commit({
      slug: "reviewer",
      marker: "review instructions",
    });
    const result = await gitInstallMain({
      slug: "reviewer",
      remote: repository.remote,
      trustSource: true,
      nonInteractive: true,
      silent: true,
    });

    expect(result.success).toBe(true);
    const config = JSON.parse(
      await fs.readFile(path.join(testRoot, ".nori-config.json"), "utf8"),
    ) as { activeSkillset?: string };
    expect(config.activeSkillset).toBe("personal/reviewer");
    await expect(
      fs.readFile(path.join(testRoot, ".claude", "CLAUDE.md"), "utf8"),
    ).resolves.toContain("review instructions");
  });
});
