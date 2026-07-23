import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import { createServer } from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { updateConfig } from "@/cli/config.js";

import type * as clackPrompts from "@clack/prompts";
import type { AddressInfo } from "node:net";

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
    await expect(
      fs.readFile(path.join(testRoot, ".claude", ".nori-managed"), "utf8"),
    ).resolves.toBe("personal/reviewer");
  });

  it("creates a shallow branch-only checkout without tags", async () => {
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
    const commitCount = await execFileAsync(
      "git",
      ["rev-list", "--count", "HEAD"],
      { cwd: target },
    );
    expect(commitCount.stdout.trim()).toBe("1");
    await expect(fs.access(path.join(target, ".git", "shallow"))).resolves.toBe(
      undefined,
    );
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

  it("rejects an overlapping install before reserving its checkout", async () => {
    await repository.commit({ slug: "reviewer" });
    const lockPath = path.join(testRoot, ".nori-install.lock");
    await fs.mkdir(lockPath);
    await fs.writeFile(
      path.join(lockPath, "owner.json"),
      JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }),
    );

    try {
      const result = await install();

      expectFailure(
        result,
        /another Nori installation is already in progress/i,
      );
      await expect(fs.access(target)).rejects.toThrow();
    } finally {
      await fs.rm(lockPath, { recursive: true, force: true });
    }
  });

  it("validates a slug before rendering a lock-conflict error", async () => {
    const lockPath = path.join(testRoot, ".nori-install.lock");
    const owner = JSON.stringify({
      pid: process.pid,
      createdAt: new Date().toISOString(),
    });
    await fs.mkdir(lockPath);
    await fs.writeFile(path.join(lockPath, "owner.json"), owner);

    try {
      const result = await install({ slug: "invalid\nINJECTED-OUTPUT" });

      expectFailure(result, /lowercase letters, numbers, and hyphens only/i);
      expect(result.message).not.toContain("INJECTED-OUTPUT");
      await expect(
        fs.readFile(path.join(lockPath, "owner.json"), "utf8"),
      ).resolves.toBe(owner);
    } finally {
      await fs.rm(lockPath, { recursive: true, force: true });
    }
  });

  it("requires explicit trust in non-interactive mode", async () => {
    await repository.commit({ slug: "reviewer" });

    expectFailure(await install({ trustSource: null }), /--trust-source/);
    await expect(fs.access(target)).rejects.toThrow();
  });

  it.each([
    { label: "decline", approval: false },
    { label: "cancel", approval: Symbol("cancel") },
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
    await fs.writeFile(path.join(testRoot, ".claude.json"), "not valid json");

    const scopedInstallDir = path.join(
      testRoot,
      "project $HOME `ignored-command` 'quoted'",
    );
    const result = await install({ installDir: scopedInstallDir });

    expectFailure(result, /activation.*incomplete|checkout.*retained/i);
    await expect(fs.access(target)).resolves.toBe(undefined);
    const config = JSON.parse(
      await fs.readFile(path.join(testRoot, ".nori-config.json"), "utf8"),
    ) as { activeSkillset?: string | null };
    expect(config.activeSkillset ?? null).toBe(null);
    await expect(
      fs.access(path.join(testRoot, ".nori-install-in-progress")),
    ).rejects.toThrow();
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

  it("marks only agents whose activation succeeded", async () => {
    await updateConfig({ defaultAgents: ["claude-code", "codex"] });
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
    await fs.mkdir(path.join(testRoot, ".codex", "config.toml"), {
      recursive: true,
    });

    const result = await install();

    expectFailure(result, /activation.*incomplete|checkout.*retained/i);
    await expect(
      fs.readFile(path.join(testRoot, ".claude", ".nori-managed"), "utf8"),
    ).resolves.toBe("personal/reviewer");
    await expect(
      fs.readFile(path.join(testRoot, ".claude", "CLAUDE.md"), "utf8"),
    ).resolves.toContain("test skillset");
    await expect(
      fs.access(path.join(testRoot, ".codex", ".nori-managed")),
    ).rejects.toThrow();
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
