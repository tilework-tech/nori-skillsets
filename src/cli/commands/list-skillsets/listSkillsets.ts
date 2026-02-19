/**
 * List skillsets command for Nori Skillsets CLI
 * Lists locally available skillsets for programmatic use
 */

import { log } from "@clack/prompts";

import { listProfiles } from "@/cli/features/managedFolder.js";

import type { Command } from "commander";

/**
 * Main function for list-skillsets command
 */
export const listSkillsetsMain = async (): Promise<void> => {
  // Get and output profiles - one per line for easy parsing
  // Profiles are always loaded from ~/.nori/profiles/
  const profiles = await listProfiles();

  if (profiles.length === 0) {
    log.error("No skillsets installed.");
    process.exit(1);
  }

  // Output raw lines for scripting
  for (const profile of profiles) {
    process.stdout.write(profile + "\n");
  }
};

/**
 * Register the 'list-skillsets' command with commander
 * @param args - Configuration arguments
 * @param args.program - Commander program instance
 */
export const registerListSkillsetsCommand = (args: {
  program: Command;
}): void => {
  const { program } = args;

  program
    .command("list-skillsets")
    .description("List locally available skillsets (one per line)")
    .action(async () => {
      await listSkillsetsMain();
    });
};
