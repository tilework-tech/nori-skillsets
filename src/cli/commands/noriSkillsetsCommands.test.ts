/**
 * Tests for nori-skillsets command registration.
 */

import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as clackPrompts from "@clack/prompts";

import {
  registerNoriSkillsetsInstallCommand,
  registerNoriSkillsetsNewCommand,
  registerNoriSkillsetsPublishCommand,
  registerNoriSkillsetsUploadSkillCommand,
} from "./noriSkillsetsCommands.js";

const framing = vi.hoisted(() => ({
  intro: vi.fn(),
  outro: vi.fn(),
}));

vi.mock("@clack/prompts", async (importOriginal) => ({
  ...(await importOriginal<typeof clackPrompts>()),
  intro: framing.intro,
  outro: framing.outro,
}));

const commandDelegates = vi.hoisted(() => ({
  gitInstall: vi.fn().mockResolvedValue({
    success: true,
    cancelled: false,
    message: "installed from git",
  }),
  registryInstall: vi.fn().mockResolvedValue({
    success: true,
    cancelled: false,
    message: "installed from registry",
  }),
  newSkillset: vi.fn().mockResolvedValue({
    success: true,
    cancelled: false,
    message: "created",
  }),
  publishSkillset: vi.fn().mockResolvedValue({
    success: true,
    cancelled: false,
    message: "published",
  }),
}));

vi.mock("@/cli/commands/git-install/gitInstall.js", () => ({
  gitInstallMain: commandDelegates.gitInstall,
}));

vi.mock("@/cli/commands/registry-install/registryInstall.js", () => ({
  registryInstallMain: commandDelegates.registryInstall,
}));

vi.mock("@/cli/commands/new-skillset/newSkillset.js", () => ({
  newSkillsetMain: commandDelegates.newSkillset,
}));

vi.mock("@/cli/commands/publish-skillset/publishSkillset.js", () => ({
  publishSkillsetMain: commandDelegates.publishSkillset,
}));

describe("registerNoriSkillsetsNewCommand", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(["new", "new-skillset"])(
    "%s forwards its optional positional skillset name",
    async (commandName) => {
      const program = new Command();
      program.exitOverride();
      registerNoriSkillsetsNewCommand({ program });

      await program.parseAsync([commandName, "my-skillset"], { from: "user" });

      expect(commandDelegates.newSkillset).toHaveBeenCalledWith({
        skillsetName: "my-skillset",
      });
    },
  );
});

describe("registerNoriSkillsetsInstallCommand", () => {
  const gitArgs = [
    "reviewer",
    "--from",
    "/tmp/skillsets.git",
    "--pin",
    "0123456789012345678901234567890123456789",
    "--trust-source",
  ];

  const runInstall = (...args: Array<string>) => {
    const program = new Command();
    program.exitOverride();
    program.option("--silent");
    registerNoriSkillsetsInstallCommand({ program });
    return program.parseAsync(["node", "sks", "install", ...args]);
  };

  const expectInstallFailure = async (...args: Array<string>) => {
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("exit 1");
    }) as never);
    try {
      await expect(runInstall(...args)).rejects.toThrow("exit 1");
    } finally {
      exit.mockRestore();
    }
  };

  beforeEach(() => vi.clearAllMocks());

  it("uses the Git source path exclusively when --from is supplied", async () => {
    await runInstall(...gitArgs, "--silent");

    expect(commandDelegates.gitInstall).toHaveBeenCalledWith({
      slug: "reviewer",
      remote: "/tmp/skillsets.git",
      installDir: null,
      nonInteractive: true,
      pin: "0123456789012345678901234567890123456789",
      silent: true,
      trustSource: true,
    });
    expect(commandDelegates.registryInstall).not.toHaveBeenCalled();
  });

  it("preserves the Registry install path when --from is absent", async () => {
    await runInstall("reviewer");

    expect(commandDelegates.registryInstall).toHaveBeenCalledWith({
      packageSpec: "reviewer",
      installDir: null,
      nonInteractive: null,
      silent: null,
    });
    expect(commandDelegates.gitInstall).not.toHaveBeenCalled();
  });

  it("does not fall back to the Registry when a Git install fails", async () => {
    commandDelegates.gitInstall.mockResolvedValueOnce({
      success: false,
      cancelled: false,
      message: "git failed",
    });
    await expectInstallFailure(...gitArgs);

    expect(commandDelegates.registryInstall).not.toHaveBeenCalled();
  });

  it("does not exit or fall back when a Git install is cancelled", async () => {
    commandDelegates.gitInstall.mockResolvedValueOnce({
      success: false,
      cancelled: true,
      message: "",
    });
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("unexpected exit");
    }) as never);

    try {
      await runInstall(...gitArgs);
    } finally {
      exit.mockRestore();
    }

    expect(commandDelegates.registryInstall).not.toHaveBeenCalled();
  });

  it.each(["--trust-source", "--pin"])(
    "rejects Git-only option %s when no Git source is supplied",
    async (option) => {
      const args = option === "--pin" ? [option, "0".repeat(40)] : [option];
      await expectInstallFailure("reviewer", ...args);

      expect(commandDelegates.gitInstall).not.toHaveBeenCalled();
      expect(commandDelegates.registryInstall).not.toHaveBeenCalled();
      expect(framing.outro).toHaveBeenCalledWith(
        expect.stringContaining("--from <git-remote>"),
      );
    },
  );

  it("describes the accepted full object ID lengths in install help", () => {
    const program = new Command();
    registerNoriSkillsetsInstallCommand({ program });
    const installCommand = program.commands.find(
      (command) => command.name() === "install",
    );

    expect(installCommand?.helpInformation()).toMatch(/--pin.*full.*40.*64/is);
  });
});

describe("registerNoriSkillsetsPublishCommand", () => {
  beforeEach(() => vi.clearAllMocks());

  it("forwards the explicit destination and deliberate publication options", async () => {
    const program = new Command();
    program.exitOverride();
    program.option("--non-interactive");
    program.option("--silent");
    registerNoriSkillsetsPublishCommand({ program });

    await program.parseAsync(
      [
        "node",
        "sks",
        "--non-interactive",
        "publish",
        "acme/reviewer",
        "--to",
        "/tmp/skillsets.git",
        "--message",
        "Publish reviewer v2",
        "--yes",
      ],
      { from: "node" },
    );

    expect(commandDelegates.publishSkillset).toHaveBeenCalledWith({
      message: "Publish reviewer v2",
      nonInteractive: true,
      remote: "/tmp/skillsets.git",
      silent: null,
      skillset: "acme/reviewer",
      yes: true,
    });
  });

  it("requires an explicit --to destination", async () => {
    const program = new Command();
    program.exitOverride();
    registerNoriSkillsetsPublishCommand({ program });

    await expect(
      program.parseAsync(["publish", "reviewer"], { from: "user" }),
    ).rejects.toMatchObject({ code: "commander.missingMandatoryOptionValue" });
    expect(commandDelegates.publishSkillset).not.toHaveBeenCalled();
  });
});

describe("registerNoriSkillsetsUploadSkillCommand", () => {
  const buildUploadSkillCommand = (): Command => {
    const program = new Command();
    // Mirror the real CLI, which registers a program-level version flag.
    program.version("9.9.9");
    registerNoriSkillsetsUploadSkillCommand({ program });
    const command = program.commands.find((c) => c.name() === "upload-skill");
    if (command == null) {
      throw new Error("upload-skill command was not registered");
    }
    return command;
  };

  it("does not define a --version option (it collides with the program's global --version; version is set via skill@version)", () => {
    const command = buildUploadSkillCommand();
    const longFlags = command.options.map((option) => option.long);
    expect(longFlags).not.toContain("--version");
  });

  it("still registers its real options", () => {
    const command = buildUploadSkillCommand();
    const longFlags = command.options.map((option) => option.long);
    expect(longFlags).toEqual(
      expect.arrayContaining([
        "--skillset",
        "--registry",
        "--public",
        "--description",
      ]),
    );
  });
});
