/**
 * Tests for nori-skillsets command registration.
 */

import * as fs from "fs/promises";
import * as path from "path";

import { Command } from "commander";
import { describe, it, expect } from "vitest";

import {
  registerNoriSkillsetsNewCommand,
  registerNoriSkillsetsUploadSkillCommand,
} from "./noriSkillsetsCommands.js";

describe("registerNoriSkillsetsNewCommand", () => {
  it.each(["new", "new-skillset"])(
    "%s forwards its optional positional skillset name",
    async (commandName) => {
      const program = new Command();
      program.exitOverride();
      registerNoriSkillsetsNewCommand({ program });
      const skillsetName = `forwarded-by-${commandName}`;

      await program.parseAsync([commandName, skillsetName], { from: "user" });

      const homeDir = process.env.HOME;
      if (homeDir == null) {
        throw new Error("Test HOME is not configured");
      }
      const manifest = JSON.parse(
        await fs.readFile(
          path.join(
            homeDir,
            ".nori",
            "profiles",
            "personal",
            skillsetName,
            "nori.json",
          ),
          "utf-8",
        ),
      );
      expect(manifest.name).toBe(skillsetName);
    },
  );
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
