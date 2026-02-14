/**
 * Edit skillset command for Nori Skillsets CLI
 * Opens the active skillset's profile folder in VS Code or provides fallback instructions
 */

import { execFile } from "child_process";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { log, note, outro } from "@clack/prompts";

import {
  loadConfig,
  getAgentProfile,
  getInstalledAgents,
} from "@/cli/config.js";
import { getNoriProfilesDir } from "@/cli/features/claude-code/paths.js";

import type { ConfigAgentName } from "@/cli/config.js";

/**
 * Main function for edit-skillset command
 * @param args - Configuration arguments
 * @param args.name - Optional profile name to open (defaults to active profile)
 * @param args.agent - Optional agent name override
 */
export const editSkillsetMain = async (args: {
  name?: string | null;
  agent?: string | null;
}): Promise<void> => {
  const { name, agent: agentOption } = args;

  // Determine which profile to open
  let profileName: string;

  if (name != null && name !== "") {
    profileName = name;
  } else {
    // Load config to find the active profile
    // Use os.homedir() as startDir since edit-skillset is home-directory-based
    const config = await loadConfig({ startDir: os.homedir() });

    // Determine agent name
    let agentName: ConfigAgentName;
    if (agentOption != null && agentOption !== "") {
      agentName = agentOption as ConfigAgentName;
    } else {
      const installedAgents = config ? getInstalledAgents({ config }) : [];
      agentName = (installedAgents[0] ?? "claude-code") as ConfigAgentName;
    }

    const profile = config ? getAgentProfile({ config, agentName }) : null;

    if (profile == null) {
      log.error(
        "No active skillset configured. Use 'nori-skillsets switch <name>' to set one.",
      );
      process.exit(1);
      return;
    }

    profileName = profile.baseProfile;
  }

  // Resolve the profile directory path
  const profilesDir = getNoriProfilesDir();
  const profileDir = path.join(profilesDir, profileName);

  // Verify the profile directory exists
  try {
    await fs.access(profileDir);
  } catch {
    log.error(`Skillset '${profileName}' not found at ${profileDir}`);
    process.exit(1);
    return;
  }

  // Try to open in VS Code
  const opened = await tryOpenInVsCode({ profileDir });

  if (opened) {
    log.success(`Opened '${profileName}' in VS Code`);
    outro("Done");
  } else {
    // Fallback: show directory contents in a note
    let noteContent = profileDir;

    // List directory contents
    try {
      const entries = await fs.readdir(profileDir, { withFileTypes: true });
      const dirs = entries
        .filter((e) => e.isDirectory())
        .map((e) => e.name + "/");
      const files = entries.filter((e) => e.isFile()).map((e) => e.name);

      const contentsList = [
        ...dirs.sort().map((d) => `  ${d}`),
        ...files.sort().map((f) => `  ${f}`),
      ].join("\n");

      noteContent = `${profileDir}\n\nContents:\n${contentsList}`;
    } catch {
      // Directory listing failed; just show the path
    }

    note(noteContent, `Skillset '${profileName}'`);

    log.info(`To open in VS Code: code ${profileDir}`);
    log.info(`To navigate there:  cd ${profileDir}`);
    outro("Done");
  }
};

/**
 * Attempt to open a directory in VS Code
 * @param args - Configuration arguments
 * @param args.profileDir - The directory path to open
 *
 * @returns true if VS Code was opened successfully, false otherwise
 */
const tryOpenInVsCode = (args: { profileDir: string }): Promise<boolean> => {
  const { profileDir } = args;

  return new Promise((resolve) => {
    execFile("code", [profileDir], (err) => {
      if (err != null) {
        resolve(false);
      } else {
        resolve(true);
      }
    });
  });
};
