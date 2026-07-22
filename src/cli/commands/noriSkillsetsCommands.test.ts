/**
 * Tests for nori-skillsets command registration.
 */

import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
}));

vi.mock("@/cli/commands/git-install/gitInstall.js", () => ({
  gitInstallMain: commandDelegates.gitInstall,
}));

vi.mock("@/cli/commands/registry-install/registryInstall.js", () => ({
  registryInstallMain: commandDelegates.registryInstall,
}));

import {
  registerNoriSkillsetsInstallCommand,
  registerNoriSkillsetsUploadSkillCommand,
} from "./noriSkillsetsCommands.js";

describe("registerNoriSkillsetsInstallCommand", () => {
  const gitArgs = [
    "reviewer",
    "--from",
    "/tmp/skillsets.git",
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

  it("rejects Git-only options when no Git source is supplied", async () => {
    await expectInstallFailure("reviewer", "--trust-source");

    expect(commandDelegates.gitInstall).not.toHaveBeenCalled();
    expect(commandDelegates.registryInstall).not.toHaveBeenCalled();
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
