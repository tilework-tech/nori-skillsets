/**
 * Tests for nori-skillsets command registration.
 */

import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  beforeEach(() => {
    vi.clearAllMocks();
    commandDelegates.gitInstall.mockResolvedValue({
      success: true,
      cancelled: false,
      message: "installed from git",
    });
    commandDelegates.registryInstall.mockResolvedValue({
      success: true,
      cancelled: false,
      message: "installed from registry",
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses the Git source path exclusively when --from is supplied", async () => {
    const program = new Command();
    program.exitOverride();
    program.option("--silent");
    registerNoriSkillsetsInstallCommand({ program });

    await program.parseAsync([
      "node",
      "sks",
      "install",
      "reviewer",
      "--from",
      "/tmp/skillsets.git",
      "--trust-source",
      "--silent",
    ]);

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
    const program = new Command();
    program.exitOverride();
    registerNoriSkillsetsInstallCommand({ program });

    await program.parseAsync(["node", "sks", "install", "reviewer"]);

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
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("exit 1");
    }) as never);
    const program = new Command();
    program.exitOverride();
    registerNoriSkillsetsInstallCommand({ program });

    await expect(
      program.parseAsync([
        "node",
        "sks",
        "install",
        "reviewer",
        "--from",
        "/tmp/skillsets.git",
        "--trust-source",
      ]),
    ).rejects.toThrow("exit 1");

    expect(commandDelegates.registryInstall).not.toHaveBeenCalled();
    exit.mockRestore();
  });

  it("rejects Git-only options when no Git source is supplied", async () => {
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("exit 1");
    }) as never);
    const program = new Command();
    program.exitOverride();
    registerNoriSkillsetsInstallCommand({ program });

    await expect(
      program.parseAsync([
        "node",
        "sks",
        "install",
        "reviewer",
        "--trust-source",
      ]),
    ).rejects.toThrow("exit 1");

    expect(commandDelegates.gitInstall).not.toHaveBeenCalled();
    expect(commandDelegates.registryInstall).not.toHaveBeenCalled();
    exit.mockRestore();
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
