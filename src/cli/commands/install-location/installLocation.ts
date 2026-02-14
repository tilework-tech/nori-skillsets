/**
 * Install Location Command
 *
 * Displays Nori installation directories found in the current directory and parent directories.
 */

import { log, note, outro } from "@clack/prompts";

import {
  getInstallDirs,
  getInstallDirsWithTypes,
  type InstallationInfo,
} from "@/utils/path.js";

import type { Command } from "commander";

/**
 * Main function for install-location command
 * Displays Nori installation directories with optional filtering
 *
 * @param args - Configuration arguments
 * @param args.currentDir - Directory to start searching from (defaults to process.cwd())
 * @param args.installationSource - If true, only show source installations (with config file)
 * @param args.managedInstallation - If true, only show managed installations (with CLAUDE.md block)
 * @param args.nonInteractive - If true, output plain paths without formatting
 */
export const installLocationMain = async (args?: {
  currentDir?: string | null;
  installationSource?: boolean | null;
  managedInstallation?: boolean | null;
  nonInteractive?: boolean | null;
}): Promise<void> => {
  const {
    currentDir,
    installationSource,
    managedInstallation,
    nonInteractive,
  } = args ?? {};

  const searchDir = currentDir ?? process.cwd();

  // Validate mutually exclusive flags
  if (installationSource && managedInstallation) {
    log.error(
      "Cannot use both --installation-source and --installation-managed flags",
    );
    process.exit(1);
  }

  const allInstallations = getInstallDirsWithTypes({ currentDir: searchDir });

  // Filter based on flags
  let filteredInstallations: Array<InstallationInfo>;

  if (installationSource) {
    // Include "source" and "both" types
    filteredInstallations = allInstallations.filter(
      (i) => i.type === "source" || i.type === "both",
    );
  } else if (managedInstallation) {
    // Include "managed" and "both" types
    filteredInstallations = allInstallations.filter(
      (i) => i.type === "managed" || i.type === "both",
    );
  } else {
    filteredInstallations = allInstallations;
  }

  // Handle no installations found
  if (filteredInstallations.length === 0) {
    if (installationSource) {
      log.error(
        "No Nori installation sources found in current directory or parent directories",
      );
    } else if (managedInstallation) {
      log.error(
        "No Nori managed installations found in current directory or parent directories",
      );
    } else {
      log.error(
        "No Nori installations found in current directory or parent directories",
      );
    }
    process.exit(1);
  }

  // Non-interactive output: plain paths, one per line
  if (nonInteractive) {
    for (const installation of filteredInstallations) {
      process.stdout.write(installation.path + "\n");
    }
    return;
  }

  // Interactive output: formatted with categories using note()
  // When filtering, just show the filtered results under appropriate header
  if (installationSource) {
    // Only showing source installations
    const pathsList = filteredInstallations.map((i) => i.path).join("\n");
    const title =
      filteredInstallations.length === 1
        ? "Installation source"
        : "Installation sources";
    note(pathsList, title);
    outro("Done");
    return;
  }

  if (managedInstallation) {
    // Only showing managed installations
    const pathsList = filteredInstallations.map((i) => i.path).join("\n");
    const title =
      filteredInstallations.length === 1
        ? "Managed installation"
        : "Managed installations";
    note(pathsList, title);
    outro("Done");
    return;
  }

  // No filter: group by type for display
  const sourceInstallations = filteredInstallations.filter(
    (i) => i.type === "source" || i.type === "both",
  );
  const managedInstallations = filteredInstallations.filter(
    (i) => i.type === "managed" || i.type === "both",
  );

  // Show source installations
  if (sourceInstallations.length > 0) {
    const pathsList = sourceInstallations.map((i) => i.path).join("\n");
    const title =
      sourceInstallations.length === 1
        ? "Installation source"
        : "Installation sources";
    note(pathsList, title);
  }

  // Show managed installations
  if (managedInstallations.length > 0) {
    const pathsList = managedInstallations.map((i) => i.path).join("\n");
    const title =
      managedInstallations.length === 1
        ? "Managed installation"
        : "Managed installations";
    note(pathsList, title);
  }

  outro("Done");
};

/**
 * Register the 'install-location' command with commander
 * @param args - Configuration arguments
 * @param args.program - Commander program instance
 */
export const registerInstallLocationCommand = (args: {
  program: Command;
}): void => {
  const { program } = args;

  program
    .command("install-location")
    .description("Display Nori installation directories")
    .action(async () => {
      const currentDir = process.cwd();
      const installDirs = getInstallDirs({ currentDir });

      if (installDirs.length === 0) {
        log.error(
          "No Nori installations found in current directory or parent directories",
        );
        process.exit(1);
      }

      const pathsList = installDirs.join("\n");
      note(pathsList, "Nori installation directories");
      outro("Done");
    });
};
