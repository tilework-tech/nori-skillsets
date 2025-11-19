#!/usr/bin/env node

/**
 * Nori Profiles CLI Router
 *
 * Routes commands to the appropriate installer/uninstaller.
 */

import { handshake } from "@/api/index.js";
import {
  loadDiskConfig,
  generateConfig,
  validateDiskConfig,
} from "@/installer/config.js";
import { LoaderRegistry } from "@/installer/features/loaderRegistry.js";
import { main as installMain } from "@/installer/install.js";
import { error, success, info, warn } from "@/installer/logger.js";
import { switchProfile } from "@/installer/profiles.js";
import { main as uninstallMain } from "@/installer/uninstall.js";
import { normalizeInstallDir } from "@/utils/path.js";

const showHelp = (): void => {
  console.log("Usage: nori-ai [command] [options]");
  console.log("");
  console.log("Commands:");
  console.log("  install              Install Nori Profiles (default)");
  console.log("  uninstall            Uninstall Nori Profiles");
  console.log(
    "  check                Validate Nori installation and configuration",
  );
  console.log(
    "  switch-profile <name> Switch to a different profile and reinstall",
  );
  console.log("  help                 Show this help message");
  console.log("");
  console.log("Options:");
  console.log(
    "  --install-dir <path> Install to custom directory (default: ~/.claude)",
  );
  console.log("  --non-interactive    Run without prompts");
};

/**
 * Run validation checks on Nori installation
 * @param args - Configuration arguments
 * @param args.installDir - Custom installation directory (optional)
 */
const checkMain = async (args?: {
  installDir?: string | null;
}): Promise<void> => {
  const { installDir } = args || {};

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
  const config = generateConfig({ diskConfig });

  // Add installDir to config
  if (installDir != null) {
    config.installDir = installDir;
  }

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
    warn({ message: 'Run "nori-ai install" to fix installation issues' });
    process.exit(1);
  } else {
    success({ message: "All validation checks passed!" });
    info({ message: `Installation mode: ${config.installType}` });
  }
};

/**
 * Parse --install-dir <path> from args
 * @param args - Command line arguments
 *
 * @returns The install directory path or null
 */
const parseInstallDir = (args: Array<string>): string | null => {
  const index = args.indexOf("--install-dir");
  if (index === -1 || index === args.length - 1) {
    return null;
  }
  const rawPath = args[index + 1];
  // Normalize the path (handles ~, relative paths, and .claude suffix)
  return normalizeInstallDir({ installDir: rawPath });
};

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);
  const command = args[0] || "install";

  if (command === "help" || command === "--help" || command === "-h") {
    showHelp();
    return;
  }

  // Check for --non-interactive flag
  const nonInteractive = args.includes("--non-interactive");

  // Check for --install-dir flag
  const installDir = parseInstallDir(args);

  if (command === "install") {
    await installMain({ nonInteractive, installDir });
    return;
  }

  if (command === "uninstall") {
    await uninstallMain({ nonInteractive, installDir });
    return;
  }

  if (command === "check") {
    await checkMain({ installDir });
    return;
  }

  if (command === "switch-profile") {
    const profileName = args[1];

    if (!profileName) {
      error({ message: "Profile name is required" });
      console.log("Usage: nori-ai switch-profile <profile-name>");
      process.exit(1);
    }

    // Switch to the profile
    await switchProfile({ profileName, installDir });

    // Run install in non-interactive mode with skipUninstall
    // This preserves custom user profiles during the profile switch
    info({ message: "Applying profile configuration..." });
    await installMain({
      nonInteractive: true,
      skipUninstall: true,
      installDir,
    });

    return;
  }

  error({ message: `Unknown command: ${command}` });
  console.log("");
  showHelp();
  process.exit(1);
};

main();
