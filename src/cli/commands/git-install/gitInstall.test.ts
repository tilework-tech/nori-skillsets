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

describe("gitInstallMain", () => {
  let testRoot: string;
  let target: string;
  let previousGlobalConfig: string | undefined;
  let repository: Awaited<ReturnType<typeof createTestGitRepository>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    testRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nori-git-install-"));
    target = path.join(testRoot, ".nori", "profiles", "personal", "reviewer");
    previousGlobalConfig = process.env.NORI_GLOBAL_CONFIG;
    process.env.NORI_GLOBAL_CONFIG = testRoot;
    repository = await createTestGitRepository(
      path.join(testRoot, "repository"),
    );
  });

  afterEach(async () => {
    if (previousGlobalConfig == null) {
      delete process.env.NORI_GLOBAL_CONFIG;
    } else {
      process.env.NORI_GLOBAL_CONFIG = previousGlobalConfig;
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

  const expectRejectedCheckout = async (error: RegExp) => {
    expectFailure(await install(), error);
    await expect(fs.access(target)).rejects.toThrow();
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
