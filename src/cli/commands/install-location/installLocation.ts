/**
 * Install Location Command
 *
 * Displays Nori installation directories found in the current directory and parent directories.
 */

import { error, success, info, newline, raw } from "@/cli/logger.js";
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
    error({
      message:
        "Cannot use both --installation-source and --managed-installation flags",
    });
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
      error({
        message:
          "No Nori installation sources found in current directory or parent directories",
      });
    } else if (managedInstallation) {
      error({
        message:
          "No Nori managed installations found in current directory or parent directories",
      });
    } else {
      error({
        message:
          "No Nori installations found in current directory or parent directories",
      });
    }
    process.exit(1);
  }

  // Non-interactive output: plain paths, one per line
  if (nonInteractive) {
    for (const installation of filteredInstallations) {
      raw({ message: installation.path });
    }
    return;
  }

  // Interactive output: formatted with categories
  newline();

  // When filtering, just show the filtered results under appropriate header
  if (installationSource) {
    // Only showing source installations
    info({
      message:
        filteredInstallations.length === 1
          ? "Installation source:"
          : "Installation sources:",
    });
    newline();
    for (const installation of filteredInstallations) {
      success({ message: `  ${installation.path}` });
    }
    newline();
    return;
  }

  if (managedInstallation) {
    // Only showing managed installations
    info({
      message:
        filteredInstallations.length === 1
          ? "Managed installation:"
          : "Managed installations:",
    });
    newline();
    for (const installation of filteredInstallations) {
      success({ message: `  ${installation.path}` });
    }
    newline();
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
    info({
      message:
        sourceInstallations.length === 1
          ? "Installation source:"
          : "Installation sources:",
    });
    newline();
    for (const installation of sourceInstallations) {
      success({ message: `  ${installation.path}` });
    }
    newline();
  }

  // Show managed installations
  if (managedInstallations.length > 0) {
    info({
      message:
        managedInstallations.length === 1
          ? "Managed installation:"
          : "Managed installations:",
    });
    newline();
    for (const installation of managedInstallations) {
      success({ message: `  ${installation.path}` });
    }
    newline();
  }
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
        error({
          message:
            "No Nori installations found in current directory or parent directories",
        });
        process.exit(1);
      }

      newline();
      info({ message: "Nori installation directories:" });
      newline();

      for (const dir of installDirs) {
        success({ message: `  ${dir}` });
      }

      newline();
    });
};
