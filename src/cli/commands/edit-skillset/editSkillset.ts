/**
 * Edit skillset command for Nori Skillsets CLI
 * Opens the active skillset's profile folder in VS Code or provides fallback instructions
 */

import { execFile } from "child_process";
import * as fs from "fs/promises";
import * as path from "path";

import {
  loadConfig,
  getAgentProfile,
  getInstalledAgents,
} from "@/cli/config.js";
import { getNoriProfilesDir } from "@/cli/features/claude-code/paths.js";
import { error, info, newline, raw, success } from "@/cli/logger.js";

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
    const config = await loadConfig();

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
      error({
        message:
          "No active skillset configured. Use 'nori-skillsets switch-skillset <name>' to set one.",
      });
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
    error({
      message: `Skillset '${profileName}' not found at ${profileDir}`,
    });
    process.exit(1);
    return;
  }

  // Try to open in VS Code
  const opened = await tryOpenInVsCode({ profileDir });

  if (opened) {
    success({ message: `Opened '${profileName}' in VS Code` });
  } else {
    // Fallback: print the directory path and contents
    info({ message: `Skillset '${profileName}' is located at:` });
    newline();
    raw({ message: profileDir });
    newline();

    // List directory contents
    try {
      const entries = await fs.readdir(profileDir, { withFileTypes: true });
      const dirs = entries
        .filter((e) => e.isDirectory())
        .map((e) => e.name + "/");
      const files = entries.filter((e) => e.isFile()).map((e) => e.name);

      info({ message: "Contents:" });
      for (const d of dirs.sort()) {
        raw({ message: `  ${d}` });
      }
      for (const f of files.sort()) {
        raw({ message: `  ${f}` });
      }
      newline();
    } catch {
      // Directory listing failed; still show navigation instructions
    }
    info({
      message: `To open in VS Code: code ${profileDir}`,
    });
    info({
      message: `To navigate there:  cd ${profileDir}`,
    });
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
