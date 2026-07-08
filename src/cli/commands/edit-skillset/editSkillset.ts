/**
 * Edit skillset command for Nori Skillsets CLI
 * Opens the active skillset folder in VS Code or provides fallback instructions
 */

import { execFile } from "child_process";
import * as fs from "fs/promises";

import { log, note } from "@clack/prompts";

import { loadConfig, getActiveSkillset } from "@/cli/config.js";
import { bold } from "@/cli/logger.js";
import { resolveUserSkillsetRef } from "@/norijson/skillset.js";

import type { CommandStatus } from "@/cli/commands/commandStatus.js";

/**
 * Main function for edit-skillset command
 * @param args - Configuration arguments
 * @param args.name - Optional skillset name to open (defaults to active skillset)
 * @param args.agent - Optional agent name override
 *
 * @returns Command status
 */
export const editSkillsetMain = async (args: {
  name?: string | null;
  agent?: string | null;
}): Promise<CommandStatus> => {
  const { name } = args;

  // Determine which skillset to open
  let skillsetName: string;

  if (name != null && name !== "") {
    skillsetName = name;
  } else {
    // Load config to find the active skillset
    const config = await loadConfig();

    const activeSkillset = config ? getActiveSkillset({ config }) : null;

    if (activeSkillset == null) {
      log.error(
        "No active skillset configured. Use 'nori-skillsets switch <name>' to set one.",
      );
      return {
        success: false,
        cancelled: false,
        message: "No active skillset configured",
      };
    }

    skillsetName = activeSkillset;
  }

  // Resolve the skillset directory across storage buckets (bare, public, org),
  // warning once if a deprecated bare name was used.
  const skillsetDir = (await resolveUserSkillsetRef({ name: skillsetName }))
    ?.dir;

  // Verify the skillset directory exists
  if (skillsetDir == null) {
    log.error(`Skillset '${skillsetName}' not found`);
    return {
      success: false,
      cancelled: false,
      message: `Skillset "${skillsetName}" not found`,
    };
  }

  // Try to open in VS Code
  const opened = await tryOpenInVsCode({ skillsetDir });

  if (opened) {
    log.success(`Opened '${skillsetName}' in VS Code`);
  } else {
    // Fallback: show directory contents in a note
    let noteContent = skillsetDir;

    // List directory contents
    try {
      const entries = await fs.readdir(skillsetDir, { withFileTypes: true });
      const dirs = entries
        .filter((e) => e.isDirectory())
        .map((e) => e.name + "/");
      const files = entries.filter((e) => e.isFile()).map((e) => e.name);

      const contentsList = [
        ...dirs.sort().map((d) => `  ${d}`),
        ...files.sort().map((f) => `  ${f}`),
      ].join("\n");

      noteContent = `${skillsetDir}\n\nContents:\n${contentsList}`;
    } catch {
      // Directory listing failed; just show the path
    }

    note(noteContent, `Skillset '${skillsetName}'`);

    log.info(`To open in VS Code: code ${skillsetDir}`);
    log.info(`To navigate there:  cd ${skillsetDir}`);
  }
  return {
    success: true,
    cancelled: false,
    message: `Opened skillset "${bold({ text: skillsetName })}"`,
  };
};

/**
 * Attempt to open a directory in VS Code
 * @param args - Configuration arguments
 * @param args.skillsetDir - The directory path to open
 *
 * @returns true if VS Code was opened successfully, false otherwise
 */
const tryOpenInVsCode = (args: { skillsetDir: string }): Promise<boolean> => {
  const { skillsetDir } = args;

  return new Promise((resolve) => {
    execFile("code", [skillsetDir], (err) => {
      if (err != null) {
        resolve(false);
      } else {
        resolve(true);
      }
    });
  });
};
