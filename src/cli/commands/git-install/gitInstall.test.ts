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

  it("installs the named skillset from its derived branch and records the resolved revision", async () => {
    const repository = await createTestGitRepository({ root: testRoot });
    const expectedCommit = await repository.commit({
      slug: "reviewer",
      marker: "first revision",
    });

    const result = await acquireGitSkillset({
      slug: "reviewer",
      remote: repository.remote,
      profilesDir,
      trustSource: true,
      nonInteractive: true,
    });

    expect(result.identity).toBe("personal/reviewer");
    expect(result.resolvedCommit).toBe(expectedCommit);
    await expect(
      fs.readFile(
        path.join(profilesDir, "personal", "reviewer", "AGENTS.md"),
        "utf8",
      ),
    ).resolves.toBe("first revision");
  });

  it("checks out an exact pin only when it belongs to the derived branch", async () => {
    const repository = await createTestGitRepository({ root: testRoot });
    const firstCommit = await repository.commit({
      slug: "reviewer",
      marker: "first revision",
    });
    await repository.commit({ slug: "reviewer", marker: "second revision" });

    const result = await acquireGitSkillset({
      slug: "reviewer",
      remote: repository.remote,
      pin: firstCommit,
      profilesDir,
      trustSource: true,
      nonInteractive: true,
    });

    expect(result.resolvedCommit).toBe(firstCommit);
    await expect(
      fs.readFile(
        path.join(profilesDir, "personal", "reviewer", "AGENTS.md"),
        "utf8",
      ),
    ).resolves.toBe("first revision");

    const checkout = path.join(profilesDir, "personal", "reviewer");
    const mode = await execFileAsync(
      "git",
      ["config", "--local", "--get", "nori.sourceMode"],
      { cwd: checkout },
    );
    const persistedPin = await execFileAsync(
      "git",
      ["config", "--local", "--get", "nori.sourcePin"],
      { cwd: checkout },
    );
    expect(mode.stdout.trim()).toBe("pinned");
    expect(persistedPin.stdout.trim()).toBe(firstCommit);
  });

  it("rejects a pin that is not reachable from the derived branch", async () => {
    const repository = await createTestGitRepository({ root: testRoot });
    await repository.commit({ slug: "reviewer", marker: "branch revision" });
    const unrelatedCommit = await repository.commitUnrelated({
      marker: "unrelated revision",
    });

    await expect(
      acquireGitSkillset({
        slug: "reviewer",
        remote: repository.remote,
        pin: unrelatedCommit,
        profilesDir,
        trustSource: true,
        nonInteractive: true,
      }),
    ).rejects.toThrow(/not reachable/i);
  });

  it("rejects a pin that is not a commit SHA before cloning", async () => {
    await expect(
      acquireGitSkillset({
        slug: "reviewer",
        remote: path.join(testRoot, "does-not-need-to-exist.git"),
        pin: "--not-a-sha",
        profilesDir,
        trustSource: true,
        nonInteractive: true,
      }),
    ).rejects.toThrow(/commit SHA/i);
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

  it("accepts dependency declarations whose content is materialized in the checkout", async () => {
    const repository = await createTestGitRepository({ root: testRoot });
    await repository.commit({
      slug: "reviewer",
      marker: "materialized dependencies",
      manifest: {
        dependencies: {
          skills: { formatter: "^1.0.0" },
          subagents: { researcher: "*" },
        },
      },
      files: {
        "skills/formatter/SKILL.md": "# Formatter",
        "subagents/researcher/SUBAGENT.md": "# Researcher",
      },
    });

    await expect(
      acquireGitSkillset({
        slug: "reviewer",
        remote: repository.remote,
        profilesDir,
        trustSource: true,
        nonInteractive: true,
      }),
    ).resolves.toMatchObject({ identity: "personal/reviewer" });
  });

  it("rejects packages that require unresolved Registry dependencies", async () => {
    const repository = await createTestGitRepository({ root: testRoot });
    await repository.commit({
      slug: "reviewer",
      marker: "external dependency",
      manifest: { dependencies: { skills: { formatter: "^1.0.0" } } },
    });

    await expect(
      acquireGitSkillset({
        slug: "reviewer",
        remote: repository.remote,
        profilesDir,
        trustSource: true,
        nonInteractive: true,
      }),
    ).rejects.toThrow(/self-contained|dependencies/i);
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

  it("rejects credential-bearing remote URLs before attempting a clone", async () => {
    await expect(
      acquireGitSkillset({
        slug: "reviewer",
        remote: "https://user:secret@example.invalid/repository.git",
        profilesDir,
        trustSource: true,
        nonInteractive: true,
      }),
    ).rejects.toThrow(/credentials/i);
  });

  it("rejects secret-bearing remote query strings before attempting a clone", async () => {
    await expect(
      acquireGitSkillset({
        slug: "reviewer",
        remote: "https://example.invalid/repository.git?token=secret",
        profilesDir,
        trustSource: true,
        nonInteractive: true,
      }),
    ).rejects.toThrow(/credentials/i);
  });

  it("canonicalizes a relative local remote before cloning and recording it", async () => {
    const repository = await createTestGitRepository({ root: testRoot });
    await repository.commit({ slug: "reviewer", marker: "relative remote" });
    const relativeRemote = path.relative(process.cwd(), repository.remote);

    await acquireGitSkillset({
      slug: "reviewer",
      remote: relativeRemote,
      profilesDir,
      trustSource: true,
      nonInteractive: true,
    });

    const checkout = path.join(profilesDir, "personal", "reviewer");
    const origin = await execFileAsync(
      "git",
      ["config", "--local", "--get", "remote.origin.url"],
      { cwd: checkout },
    );
    expect(origin.stdout.trim()).toBe(repository.remote);
  });

  it("stores checkout-local source metadata", async () => {
    const repository = await createTestGitRepository({ root: testRoot });
    await repository.commit({ slug: "reviewer", marker: "metadata" });

    await acquireGitSkillset({
      slug: "reviewer",
      remote: repository.remote,
      profilesDir,
      trustSource: true,
      nonInteractive: true,
    });

    const checkout = path.join(profilesDir, "personal", "reviewer");
    const branch = await execFileAsync(
      "git",
      ["config", "--local", "--get", "nori.sourceRef"],
      { cwd: checkout },
    );
    const mode = await execFileAsync(
      "git",
      ["config", "--local", "--get", "nori.sourceMode"],
      { cwd: checkout },
    );
    const resolved = await execFileAsync(
      "git",
      ["config", "--local", "--get", "nori.resolvedCommit"],
      { cwd: checkout },
    );
    expect(branch.stdout.trim()).toBe("refs/heads/skillsets/reviewer");
    expect(mode.stdout.trim()).toBe("follow");
    expect(resolved.stdout.trim()).toMatch(/^[0-9a-f]{40}$/);
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

  it("removes the acquired checkout and restores config when activation fails", async () => {
    const repository = await createTestGitRepository({
      root: path.join(testRoot, "repository"),
    });
    await repository.commit({ slug: "reviewer", marker: "will roll back" });
    const invalidInstallDir = path.join(testRoot, "not-a-directory");
    await fs.writeFile(invalidInstallDir, "existing user content");

    const result = await gitInstallMain({
      slug: "reviewer",
      remote: repository.remote,
      installDir: invalidInstallDir,
      trustSource: true,
      nonInteractive: true,
      silent: true,
    });

    expect(result.success).toBe(false);
    await expect(
      fs.access(
        path.join(testRoot, ".nori", "profiles", "personal", "reviewer"),
      ),
    ).rejects.toThrow();
    await expect(
      fs.access(path.join(testRoot, ".nori-config.json")),
    ).rejects.toThrow();
    await expect(fs.readFile(invalidInstallDir, "utf8")).resolves.toBe(
      "existing user content",
    );
  });

  it("restores the previously active skillset when replacement activation fails", async () => {
    const originalRepository = await createTestGitRepository({
      root: path.join(testRoot, "original-repository"),
    });
    await originalRepository.commit({
      slug: "original",
      marker: "original instructions",
    });
    const initial = await gitInstallMain({
      slug: "original",
      remote: originalRepository.remote,
      trustSource: true,
      nonInteractive: true,
      silent: true,
    });
    expect(initial.success).toBe(true);
    await fs.writeFile(
      path.join(testRoot, ".claude", "settings.json"),
      "not valid json",
    );

    const replacementRepository = await createTestGitRepository({
      root: path.join(testRoot, "replacement-repository"),
    });
    await replacementRepository.commit({
      slug: "replacement",
      marker: "replacement instructions",
    });

    const replacement = await gitInstallMain({
      slug: "replacement",
      remote: replacementRepository.remote,
      trustSource: true,
      nonInteractive: true,
      silent: true,
    });

    expect(replacement.success).toBe(false);
    const config = JSON.parse(
      await fs.readFile(path.join(testRoot, ".nori-config.json"), "utf8"),
    ) as { activeSkillset?: string };
    expect(config.activeSkillset).toBe("personal/original");
    await expect(
      fs.readFile(path.join(testRoot, ".claude", "CLAUDE.md"), "utf8"),
    ).resolves.toContain("original instructions");
    await expect(
      fs.access(
        path.join(testRoot, ".nori", "profiles", "personal", "replacement"),
      ),
    ).rejects.toThrow();
  });
});
