#!/usr/bin/env node

/**
 * List Noridocs script - List all server-side documentation
 *
 * IMPORTANT: This file is BUNDLED during the build process.
 *
 * @see scripts/bundle-skills.ts - Bundler that creates standalone executables
 * @see src/cli/features/claude-code/profiles/config/_mixins/_paid/skills/paid-recall/script.ts - Full bundling documentation
 */

import minimist from "minimist";

import { apiClient } from "@/api/index.js";
import { loadConfig, isPaidInstall } from "@/cli/config.js";
import { getInstallDirs } from "@/utils/path.js";

/**
 * Show usage information
 */
const showUsage = (): void => {
  console.error(`Usage: node script.js [--pathPrefix="@/path"] [--repository="repo-name"] [--limit=100]

Parameters:
  --pathPrefix  (optional) Filter by prefix like "@/server" or "@my-repo/server"
  --repository  (optional) Filter by repository name (e.g., "my-repo", "no-repository")
  --limit       (optional) Maximum results (default: 100)

Examples:
  # List all noridocs
  node script.js

  # List noridocs in my-repo repository
  node script.js --repository="my-repo"

  # List noridocs under server directory
  node script.js --pathPrefix="@/server"

  # Combine repository and path filtering
  node script.js --repository="my-repo" --pathPrefix="@my-repo/server"

  # List with custom limit
  node script.js --repository="my-repo" --limit=50

Description:
  Lists all noridocs, optionally filtered by repository and/or path prefix.

  Repository Filtering:
  - Use --repository to filter by repository scope
  - Repository names match those in the @<repository>/path format
  - Use "no-repository" to find docs without a repository scope

  Path Prefix Examples:
  - No prefix: Returns all noridocs
  - Prefix "@/server": Returns all noridocs under server directory (any repository)
  - Prefix "@nori-watchtower/server": Returns noridocs in specific repository and path
  - Prefix "@nori-watchtower/server/src/persistence": Returns noridocs in specific folder`);
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

  const pathPrefix = (args.pathPrefix as string | null) ?? null;
  const repository = (args.repository as string | null) ?? null;
  const limit = (args.limit as number | null) ?? 100;

  // Show usage if help requested
  if (args.help || args.h) {
    showUsage();
    process.exit(0);
  }

  // 3. Execute API call
  const noridocs = await apiClient.noridocs.list({ limit, repository });

  const filtered = pathPrefix
    ? noridocs.filter((n) => n.sourceUrl && n.sourceUrl.startsWith(pathPrefix))
    : noridocs;

  // 4. Format and display output
  if (filtered.length === 0) {
    console.log(
      pathPrefix
        ? `No noridocs found with prefix "${pathPrefix}"`
        : "No noridocs found",
    );
    return;
  }

  const formatted = filtered
    .map(
      (n, i) =>
        `${i + 1}. ${n.sourceUrl}
   Last updated: ${new Date(n.updatedAt).toLocaleString()}`,
    )
    .join("\n\n");

  console.log(`Found ${filtered.length} noridoc(s):\n\n${formatted}`);
};

// Run main function if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: Error) => {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  });
}
