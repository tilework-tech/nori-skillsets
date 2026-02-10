/**
 * CLI command name mapping for user-facing messages
 *
 * Maps CLI name to command names.
 * Used to display correct command hints in output messages.
 */

export type CliName = "nori-skillsets";

export type CommandNames = {
  download: string;
  downloadSkill: string;
  externalSkill: string;
  fork: string;
  new: string;
  search: string;
  update: string;
  upload: string;
  uploadSkill: string;
  switchProfile: string;
};

const NORI_SKILLSETS_COMMANDS: CommandNames = {
  download: "download",
  downloadSkill: "download-skill",
  externalSkill: "external",
  fork: "fork",
  new: "new",
  search: "search",
  update: "update",
  upload: "upload",
  uploadSkill: "upload-skill",
  switchProfile: "switch-skillset",
};

/**
 * Get the command names for the CLI
 * @param _args - The function arguments
 * @param _args.cliName - The CLI name. Defaults to nori-skillsets.
 *
 * @returns The command names for the CLI
 */
export const getCommandNames = (_args: {
  cliName?: CliName | null;
}): CommandNames => {
  return NORI_SKILLSETS_COMMANDS;
};
