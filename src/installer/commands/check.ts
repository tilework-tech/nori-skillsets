/**
 * Check command registration for commander.js
 */

// Import checkMain from cli.ts - we'll need to export it
// For now, inline it temporarily to unblock
import { handshake } from "@/api/index.js";
import {
  loadDiskConfig,
  generateConfig,
  validateDiskConfig,
} from "@/installer/config.js";
import { LoaderRegistry } from "@/installer/features/loaderRegistry.js";
import { error, success, info } from "@/installer/logger.js";
import { normalizeInstallDir } from "@/utils/path.js";

import type { Command } from "commander";

/**
 * Run validation checks on Nori installation
 * @param args - Configuration arguments
 * @param args.installDir - Custom installation directory (optional)
 */
const checkMain = async (args?: {
  installDir?: string | null;
}): Promise<void> => {
  // Normalize installDir to a definite string value
  const installDir = normalizeInstallDir({ installDir: args?.installDir });

  console.log("");
  info({ message: "Running Nori Profiles validation checks..." });
  console.log("");

  let hasErrors = false;

  // Check config
  info({ message: "Checking configuration..." });
  const configResult = await validateDiskConfig({ installDir });
  if (configResult.valid) {
    success({ message: `   ✓ ${configResult.message}` });
  } else {
    error({ message: `   ✗ ${configResult.message}` });
    if (configResult.errors) {
      for (const err of configResult.errors) {
        info({ message: `     - ${err}` });
      }
    }
    hasErrors = true;
  }
  console.log("");

  // Load config to determine install type
  const diskConfig = await loadDiskConfig({ installDir });
  const config = generateConfig({ diskConfig, installDir });

  // Check server connectivity (paid mode only)
  if (config.installType === "paid") {
    info({ message: "Testing server connection..." });
    try {
      const response = await handshake();
      success({
        message: `   ✓ Server authentication successful (user: ${response.user})`,
      });
    } catch (err: any) {
      error({ message: "   ✗ Server authentication failed" });
      info({ message: `     - ${err.message}` });
      hasErrors = true;
    }
    console.log("");
  }

  // Run validation for all loaders
  const registry = LoaderRegistry.getInstance();
  const loaders = registry.getAll();

  info({ message: "Checking feature installations..." });

  for (const loader of loaders) {
    if (loader.validate) {
      try {
        const result = await loader.validate({ config });
        if (result.valid) {
          success({ message: `   ✓ ${loader.name}: ${result.message}` });
        } else {
          error({ message: `   ✗ ${loader.name}: ${result.message}` });
          if (result.errors) {
            for (const err of result.errors) {
              info({ message: `     - ${err}` });
            }
          }
          hasErrors = true;
        }
      } catch (err: any) {
        error({ message: `   ✗ ${loader.name}: Validation failed` });
        info({ message: `     - ${err.message}` });
        hasErrors = true;
      }
    }
  }

  console.log("");
  console.log("=".repeat(70));

  if (hasErrors) {
    error({ message: "Validation completed with errors" });
    process.exit(1);
  } else {
    success({ message: "All validation checks passed!" });
    info({ message: `Installation mode: ${config.installType}` });
  }
};

/**
 * Register the 'check' command with commander
 * @param args - Configuration arguments
 * @param args.program - Commander program instance
 */
export const registerCheckCommand = (args: { program: Command }): void => {
  const { program } = args;

  program
    .command("check")
    .description("Validate Nori installation and configuration")
    .action(async () => {
      // Get global options from parent
      const globalOpts = program.opts();

      await checkMain({
        installDir: globalOpts.installDir || null,
      });
    });
};
