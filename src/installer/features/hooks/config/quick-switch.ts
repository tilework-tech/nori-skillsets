/**
 * Quick-switch hook for instant profile switching
 * Intercepts /nori-switch-profile commands and executes them directly
 * without LLM inference overhead.
 */

import * as fs from "fs/promises";
import * as path from "path";

import { getInstallDirs } from "@/utils/path.js";

// Type for the stdin JSON from Claude Code
type HookInput = {
  prompt: string;
  cwd: string;
  session_id: string;
  transcript_path: string;
  permission_mode: string;
  hook_event_name: string;
};

// Type for hook output
type HookOutput = {
  decision?: "block";
  reason?: string;
  hookSpecificOutput?: {
    hookEventName: string;
    additionalContext: string;
  };
};

/**
 * List available profiles in a directory
 * @param args - Arguments object
 * @param args.profilesDir - Path to the profiles directory
 *
 * @returns Array of profile names
 */
const listProfiles = async (args: {
  profilesDir: string;
}): Promise<Array<string>> => {
  const { profilesDir } = args;
  const profiles: Array<string> = [];

  try {
    await fs.access(profilesDir);
    const entries = await fs.readdir(profilesDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const claudeMdPath = path.join(profilesDir, entry.name, "CLAUDE.md");
        try {
          await fs.access(claudeMdPath);
          profiles.push(entry.name);
        } catch {
          // Skip directories without CLAUDE.md
        }
      }
    }
  } catch {
    // Profiles directory doesn't exist
  }

  return profiles.sort();
};

/**
 * Switch to a profile
 * @param args - Arguments object
 * @param args.profileName - Name of the profile to switch to
 * @param args.profilesDir - Path to the profiles directory
 * @param args.installDir - Installation directory
 */
const switchProfile = async (args: {
  profileName: string;
  profilesDir: string;
  installDir: string;
}): Promise<void> => {
  const { profileName, profilesDir, installDir } = args;

  // Verify profile exists
  const profileDir = path.join(profilesDir, profileName);
  const claudeMdPath = path.join(profileDir, "CLAUDE.md");

  try {
    await fs.access(claudeMdPath);
  } catch {
    throw new Error(`Profile "${profileName}" not found`);
  }

  // Config is always in the install directory
  const configPath = path.join(installDir, ".nori-config.json");

  // Load current config to preserve auth
  let currentConfig: any = {};
  try {
    const content = await fs.readFile(configPath, "utf-8");
    currentConfig = JSON.parse(content);
  } catch {
    // No existing config
  }

  // Update config with new profile
  const newConfig = {
    ...currentConfig,
    profile: {
      baseProfile: profileName,
    },
  };

  await fs.writeFile(configPath, JSON.stringify(newConfig, null, 2));
};

/**
 * Main hook function
 */
const main = async (): Promise<void> => {
  // Read stdin
  const chunks: Array<Buffer> = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  const inputStr = Buffer.concat(chunks).toString("utf-8");

  // Parse input JSON
  let input: HookInput;
  try {
    if (!inputStr.trim()) {
      // Empty stdin - pass through
      process.exit(0);
    }
    input = JSON.parse(inputStr);
  } catch {
    // Invalid JSON - pass through
    process.exit(0);
  }

  const { prompt, cwd } = input;

  if (!prompt || !cwd) {
    // Missing required fields - pass through
    process.exit(0);
  }

  // Check if prompt matches /nori-switch-profile pattern
  const trimmedPrompt = prompt.trim();
  const matchWithProfile = trimmedPrompt.match(
    /^\/nori-switch-profile\s+([a-z0-9-]+)\s*$/i,
  );
  const matchWithoutProfile = trimmedPrompt.match(
    /^\/nori-switch-profile\s*$/i,
  );

  if (!matchWithProfile && !matchWithoutProfile) {
    // Not a switch command - pass through
    process.exit(0);
  }

  // ALWAYS use getInstallDirs to find installation directory
  const allInstallations = getInstallDirs({ currentDir: cwd });

  if (allInstallations.length === 0) {
    // Fail loudly - no silent fallback
    const output: HookOutput = {
      decision: "block",
      reason: `No Nori installation found.`,
    };
    console.log(JSON.stringify(output));
    process.exit(0);
  }

  const installDir = allInstallations[0]; // Use closest installation

  // Get profiles directory
  const profilesDir = path.join(installDir, ".claude", "profiles");

  // List available profiles
  const profiles = await listProfiles({ profilesDir });

  if (profiles.length === 0) {
    // No profiles found
    const output: HookOutput = {
      decision: "block",
      reason: `No profiles found in ${profilesDir}.\n\nRun 'npx nori-ai install' to install profiles.`,
    };
    console.log(JSON.stringify(output));
    process.exit(0);
  }

  if (matchWithoutProfile) {
    // List available profiles
    const output: HookOutput = {
      decision: "block",
      reason: `Available profiles: ${profiles.join(", ")}\n\nUsage: /nori-switch-profile <profile-name>`,
    };
    console.log(JSON.stringify(output));
    process.exit(0);
  }

  // Extract profile name
  const profileName = matchWithProfile![1];

  // Check if profile exists
  if (!profiles.includes(profileName)) {
    const output: HookOutput = {
      decision: "block",
      reason: `Profile "${profileName}" not found.\n\nAvailable profiles: ${profiles.join(", ")}`,
    };
    console.log(JSON.stringify(output));
    process.exit(0);
  }

  // Switch to the profile
  try {
    await switchProfile({ profileName, profilesDir, installDir });

    // Read profile description if available
    let profileDescription = "";
    try {
      const profileJsonPath = path.join(
        profilesDir,
        profileName,
        "profile.json",
      );
      const profileJson = JSON.parse(
        await fs.readFile(profileJsonPath, "utf-8"),
      );
      if (profileJson.description) {
        profileDescription = profileJson.description;
      }
    } catch {
      // No profile.json or no description
    }

    // Return context for Claude to describe the profile
    const output: HookOutput = {
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext: `Profile switched to "${profileName}"${profileDescription ? `: ${profileDescription}` : ""}.\n\nDescribe this profile to the user and tell them to restart Claude Code to apply the changes.`,
      },
    };
    console.log(JSON.stringify(output));
    process.exit(0);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const output: HookOutput = {
      decision: "block",
      reason: `Failed to switch profile: ${errorMessage}`,
    };
    console.log(JSON.stringify(output));
    process.exit(0);
  }
};

main().catch(() => {
  // Unexpected error - pass through silently
  process.exit(0);
});
