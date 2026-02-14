/**
 * Register skillset command
 *
 * Creates nori.json for an existing skillset folder under ~/.nori/profiles/.
 */

import * as fs from "fs/promises";
import * as path from "path";

import { log, note, outro } from "@clack/prompts";

import { getNoriProfilesDir } from "@/cli/features/claude-code/paths.js";
import {
  writeProfileMetadata,
  type ProfileMetadata,
} from "@/cli/features/claude-code/profiles/metadata.js";
import { registerSkillsetFlow } from "@/cli/prompts/flows/registerSkillset.js";

/**
 * Main function for register-skillset command
 *
 * @param args - The function arguments
 * @param args.skillsetName - Skillset name (null to use current active skillset)
 */
export const registerSkillsetMain = async (args: {
  skillsetName: string | null;
}): Promise<void> => {
  let { skillsetName } = args;

  // If no skillset name provided, use current active skillset
  if (skillsetName == null) {
    // Get the current skillset by reading the config directly
    // (we can't easily capture stdout from currentSkillsetMain)
    const os = await import("os");
    const { loadConfig, getAgentProfile, getInstalledAgents } =
      await import("@/cli/config.js");

    const config = await loadConfig({ startDir: os.homedir() });

    if (config == null) {
      log.error(
        "No active skillset configured. Use 'nori-skillsets switch <name>' to set one, or specify a skillset name.",
      );
      process.exit(1);
      return;
    }

    const installedAgents = getInstalledAgents({ config });
    const agentName = (installedAgents[0] ?? "claude-code") as "claude-code";
    const profile = getAgentProfile({ config, agentName });

    if (profile == null) {
      log.error(
        "No active skillset configured. Use 'nori-skillsets switch <name>' to set one, or specify a skillset name.",
      );
      process.exit(1);
      return;
    }

    skillsetName = profile.baseProfile;
  }

  const profilesDir = getNoriProfilesDir();
  const destPath = path.join(profilesDir, skillsetName);

  // Validate that the directory exists
  try {
    await fs.access(destPath);
  } catch {
    log.error(
      `Skillset '${skillsetName}' does not exist at ${destPath}. Please create it first.`,
    );
    process.exit(1);
    return;
  }

  // Validate that nori.json does NOT already exist
  const noriJsonPath = path.join(destPath, "nori.json");
  try {
    await fs.access(noriJsonPath);
    log.error(
      `Skillset '${skillsetName}' already has a nori.json manifest at ${noriJsonPath}.`,
    );
    process.exit(1);
    return;
  } catch {
    // Expected - nori.json should not exist
  }

  // Collect metadata from user
  const flowResult = await registerSkillsetFlow();

  if (flowResult == null) {
    // User cancelled
    return;
  }

  const { description, license, keywords, version, repository } = flowResult;

  // Build metadata object with name from basename
  const metadata: ProfileMetadata = {
    name: path.basename(skillsetName),
    version: version ?? "1.0.0",
  };

  if (description != null) {
    metadata.description = description;
  }

  if (license != null) {
    metadata.license = license;
  }

  if (keywords != null) {
    metadata.keywords = keywords;
  }

  if (repository != null) {
    metadata.repository = {
      type: "git",
      url: repository,
    };
  }

  // Write nori.json
  await writeProfileMetadata({
    profileDir: destPath,
    metadata,
  });

  const nextSteps = [
    `To edit:    nori-skillsets edit ${skillsetName}`,
    `Location:   ~/.nori/profiles/${skillsetName}/nori.json`,
  ].join("\n");
  note(nextSteps, "Next Steps");

  outro(`Registered skillset '${skillsetName}'`);
};
