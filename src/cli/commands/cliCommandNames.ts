/**
 * CLI command name mapping for user-facing messages
 *
 * Maps CLI names (nori-ai, seaweed) to their respective command names.
 * Used to display correct command hints in output messages.
 */

export type CliName = "nori-ai" | "seaweed";

export type CommandNames = {
  download: string;
  downloadSkill: string;
  search: string;
  update: string;
  upload: string;
  uploadSkill: string;
  switchProfile: string;
};

const NORI_AI_COMMANDS: CommandNames = {
  download: "registry-download",
  downloadSkill: "skill-download",
  search: "registry-search",
  update: "registry-update",
  upload: "registry-upload",
  uploadSkill: "skill-upload",
  switchProfile: "switch-profile",
};

const SEAWEED_COMMANDS: CommandNames = {
  download: "download",
  downloadSkill: "download-skill",
  search: "search",
  update: "update",
  upload: "upload",
  uploadSkill: "upload-skill",
  switchProfile: "switch-skillset",
};

/**
 * Get the command names for the given CLI
 * @param args - The function arguments
 * @param args.cliName - The CLI name (nori-ai or seaweed). Defaults to nori-ai.
 *
 * @returns The command names for the CLI
 */
export const getCommandNames = (args: {
  cliName?: CliName | null;
}): CommandNames => {
  const { cliName } = args;

  if (cliName === "seaweed") {
    return SEAWEED_COMMANDS;
  }

  return NORI_AI_COMMANDS;
};
