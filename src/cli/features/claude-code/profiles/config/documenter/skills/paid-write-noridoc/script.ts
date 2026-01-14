#!/usr/bin/env node

/**
 * Write Noridoc script - Write/update server-side documentation
 *
 * IMPORTANT: This file is BUNDLED during the build process.
 *
 * @see scripts/bundle-skills.ts - Bundler that creates standalone executables
 * @see src/cli/features/claude-code/profiles/config/senior-swe/skills/paid-recall/script.ts - Full bundling documentation
 */

import minimist from "minimist";

import { apiClient } from "@/api/index.js";
import { loadConfig, isPaidInstall } from "@/cli/config.js";
import { getInstallDirs } from "@/utils/path.js";

/**
 * Show usage information
 */
const showUsage = (): void => {
  console.error(`Usage: node script.js --filePath="@<repository>/path" --content="Content" [--gitRepoUrl="https://..."]

Parameters:
  --filePath    (required) Path in format "@<repository>/<path>" (e.g., "@nori-watchtower/server/src/persistence")
                          or "@/path" or plain path (defaults to 'no-repository')
  --content     (required) Markdown content
  --gitRepoUrl  (optional) Link to git repository

Examples:
  # Create noridoc with repository scope
  node script.js \\
    --filePath="@my-repo/server/src/api" \\
    --content="# API Client" \\
    --gitRepoUrl="https://github.com/username/my-repo"

  # Create noridoc without repository scope (defaults to 'no-repository')
  node script.js \\
    --filePath="@/server/src/api" \\
    --content="# API Client"

Description:
  Writes documentation to the server-side noridocs system.

  Creates new version automatically. Use this instead of writing docs.md files directly.
  If noridoc doesn't exist, creates it. If it exists, updates and increments version.

  Repository Detection:
    The repository is automatically extracted from the filePath by the server:
    - "@my-repo/server/src/api" → repository: "my-repo"
    - "@/server/src/api" → repository: "no-repository"
    - "server/src/api" → repository: "no-repository"

    Repository names must be lowercase letters, numbers, and hyphens only.`);
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
  // Check tier
  const config = await loadConfig({ installDir });
  if (config == null || !isPaidInstall({ config })) {
    console.error("Error: This feature requires a paid Nori subscription.");
    console.error("Please configure your credentials in ~/nori-config.json");
    process.exit(1);
  }

  // 2. Parse and validate arguments
  const args = minimist(process.argv.slice(2));

  if (args.filePath == null || args.content == null) {
    if (args.filePath == null) {
      console.error("Error: --filePath parameter is required");
    }
    if (args.content == null) {
      console.error("Error: --content parameter is required");
    }
    console.error("");
    showUsage();
    process.exit(1);
  }

  const filePath = args.filePath as string;
  const content = args.content as string;
  const gitRepoUrl = (args.gitRepoUrl as string | null) ?? null;

  // 3. Execute API call (try update first, fallback to create)
  try {
    const existing = await apiClient.noridocs.readByPath({ filePath });

    const updated = await apiClient.noridocs.update({
      id: existing.id,
      data: { content, gitRepoUrl },
    });

    const versions = await apiClient.noridocs.listVersions({
      id: updated.id,
    });

    console.log(
      `Successfully updated noridoc at "${filePath}" (version ${
        versions[0]?.version || "unknown"
      })`,
    );
  } catch (error) {
    // Create if doesn't exist
    await apiClient.noridocs.create({
      filePath,
      content,
      gitRepoUrl,
    });

    console.log(`Successfully created noridoc at "${filePath}" (version 1)`);
  }
};

// Run main function if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: Error) => {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  });
}
