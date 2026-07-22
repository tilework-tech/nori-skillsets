/**
 * Tests for nori-skillsets command registration.
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { Command } from "commander";
import { afterEach, describe, it, expect } from "vitest";

import {
  registerNoriSkillsetsNewCommand,
  registerNoriSkillsetsUploadSkillCommand,
} from "./noriSkillsetsCommands.js";

let newCommandHome: string | null = null;

afterEach(async () => {
  delete process.env.NORI_GLOBAL_CONFIG;
  if (newCommandHome != null) {
    await fs.rm(newCommandHome, { recursive: true, force: true });
    newCommandHome = null;
  }
});

describe("registerNoriSkillsetsNewCommand", () => {
  it.each(["new", "new-skillset"])(
    "%s accepts a positional name and creates the skillset without prompting",
    async (commandName) => {
      newCommandHome = await fs.mkdtemp(path.join(os.tmpdir(), "sks-new-cli-"));
      process.env.NORI_GLOBAL_CONFIG = newCommandHome;
      const program = new Command();
      program.exitOverride();
      registerNoriSkillsetsNewCommand({ program });

      await program.parseAsync([commandName, "cli-skillset"], {
        from: "user",
      });

      const manifest = JSON.parse(
        await fs.readFile(
          path.join(
            newCommandHome,
            ".nori",
            "profiles",
            "personal",
            "cli-skillset",
            "nori.json",
          ),
          "utf-8",
        ),
      );
      expect(manifest).toMatchObject({
        name: "cli-skillset",
        version: "1.0.0",
        type: "skillset",
      });
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
