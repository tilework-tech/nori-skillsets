/**
 * Tests for nori-skillsets command registration.
 */

import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as watchModule from "@/cli/commands/watch/watch.js";

import {
  registerNoriSkillsetsUploadSkillCommand,
  registerNoriSkillsetsWatchCommand,
} from "./noriSkillsetsCommands.js";

vi.mock("@/cli/commands/watch/watch.js", () => ({
  watchMain: vi.fn().mockResolvedValue({
    success: true,
    cancelled: false,
    message: "Transcript upload has been retired.",
  }),
  watchStopMain: vi.fn().mockResolvedValue(undefined),
}));

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

describe("registerNoriSkillsetsWatchCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    [["watch"]],
    [["watch", "--agent", "claude-code"]],
    [["watch", "--set-destination"]],
    [["watch", "--agent", "claude-code", "--_background"]],
  ])(
    "still accepts the legacy invocation %j so existing scripts do not crash",
    async (argv) => {
      const program = new Command().exitOverride();
      registerNoriSkillsetsWatchCommand({ program });

      await program.parseAsync(argv, { from: "user" });

      expect(watchModule.watchMain).toHaveBeenCalledTimes(1);
    },
  );

  it("still provides watch stop", async () => {
    const program = new Command().exitOverride();
    registerNoriSkillsetsWatchCommand({ program });

    await program.parseAsync(["watch", "stop"], { from: "user" });

    expect(watchModule.watchStopMain).toHaveBeenCalledTimes(1);
  });
});
