#!/usr/bin/env node

/**
 * Read Noridoc script - Read server-side documentation
 *
 * IMPORTANT: This file is BUNDLED during the build process.
 *
 * @see scripts/bundle-skills.ts - Bundler that creates standalone executables
 * @see mcp/src/installer/features/skills/config/paid-recall/script.ts - Full bundling documentation
 */

import minimist from "minimist";

import { apiClient } from "@/api/index.js";
import {
  loadConfig,
  getDefaultProfile,
  isPaidInstall,
} from "@/installer/config.js";
import { getInstallDirs } from "@/utils/path.js";

/**
 * Show usage information
 */
const showUsage = (): void => {
  console.error(`Usage: node script.js --filePath="@/path/to/file"

Parameters:
  --filePath   (required) The file path of the noridoc (e.g., "@/server/src/persistence")

Example:
  node script.js --filePath="@/mcp/src/api"

Description:
  Reads documentation from the server-side noridocs system.

  Use this instead of reading docs.md files directly when server-side docs are enabled.
  Searches by filePath (e.g., "@/server/src/persistence").

  Returns:
  - Current documentation content
  - Version number
  - Last updated timestamp
  - Git repository link (if available)`);
};

/**
 * Main execution function
 */
export const main = async (): Promise<void> => {
  // 1. Check tier
  // Use cwd as installDir since skill scripts run from project directory
  // ALWAYS use getInstallDirs to find installation directory
  const allInstallations = getInstallDirs({ currentDir: process.cwd() });

  if (allInstallations.length === 0) {
    // Fail loudly - no silent fallback
    console.error("Error: No Nori installation found.");
    process.exit(1);
  }

  const installDir = allInstallations[0]; // Use closest installation
  const existingConfig = await loadConfig({ installDir });
  const config = existingConfig ?? {
    profile: getDefaultProfile(),
    installDir,
  };

  if (!isPaidInstall({ config })) {
    console.error("Error: This feature requires a paid Nori subscription.");
    console.error("Please configure your credentials in ~/nori-config.json");
    process.exit(1);
  }

  // 2. Parse and validate arguments
  const args = minimist(process.argv.slice(2));

  if (args.filePath == null) {
    console.error("Error: --filePath parameter is required");
    console.error("");
    showUsage();
    process.exit(1);
  }

  const filePath = args.filePath as string;

  // 3. Execute API calls
  try {
    const noridoc = await apiClient.noridocs.readByPath({ filePath });
    const versions = await apiClient.noridocs.listVersions({
      id: noridoc.id,
    });
    const latestVersion = versions[0];

    // 4. Format and display output
    console.log(`# ${noridoc.name}

Version: ${latestVersion?.version || 1}
Last Updated: ${new Date(noridoc.updatedAt).toLocaleString()}${
      latestVersion?.gitRepoUrl ? `\nGit: ${latestVersion.gitRepoUrl}` : ""
    }

---

${noridoc.content}`);
  } catch (error) {
    console.log(`No noridoc found at path: "${filePath}"`);
    process.exit(1);
  }
};

// Run main function if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: Error) => {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  });
}
