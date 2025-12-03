/**
 * CLI command for searching profile packages in the Nori registrar
 * Handles: nori-ai registry-search <query>
 */

import { registrarApi } from "@/api/registrar.js";
import { error, success, info } from "@/installer/logger.js";

import type { Command } from "commander";

/**
 * Search for profiles in the registrar
 * @param args - The search parameters
 * @param args.query - The search query
 */
export const registrySearchMain = async (args: {
  query: string;
}): Promise<void> => {
  const { query } = args;

  try {
    const packages = await registrarApi.searchPackages({ query });

    if (packages.length === 0) {
      info({ message: `No profiles found matching "${query}".` });
      info({
        message:
          "Try a different search term or browse the registrar at https://registrar.tilework.tech",
      });
      return;
    }

    console.log("");
    success({
      message: `Found ${packages.length} profile(s) matching "${query}":`,
    });
    console.log("");

    for (const pkg of packages) {
      success({ message: `  ${pkg.name}` });
      if (pkg.description) {
        info({ message: `    ${pkg.description}` });
      }
      console.log("");
    }

    info({
      message:
        "To install a profile, run: nori-ai registry-download <package-name>",
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    error({ message: `Failed to search profiles: ${errorMessage}` });
  }
};

/**
 * Register the 'registry-search' command with commander
 * @param args - Configuration arguments
 * @param args.program - Commander program instance
 */
export const registerRegistrySearchCommand = (args: {
  program: Command;
}): void => {
  const { program } = args;

  program
    .command("registry-search <query>")
    .description("Search for profile packages in the Nori registrar")
    .action(async (query: string) => {
      await registrySearchMain({ query });
    });
};
