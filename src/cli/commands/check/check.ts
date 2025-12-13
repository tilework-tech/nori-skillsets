/**
 * Check command implementation
 *
 * Validates Nori installation and configuration
 */

import { handshake } from "@/api/index.js";
import {
  loadConfig,
  validateConfig,
  getDefaultProfile,
  isPaidInstall,
} from "@/cli/config.js";
import { AgentRegistry } from "@/cli/features/agentRegistry.js";
import { error, success, info, newline, raw } from "@/cli/logger.js";
import { getInstallDirs } from "@/utils/path.js";

import type { Command } from "commander";

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
        agent: globalOpts.agent || null,
      });
    });
};

/**
 * Run validation checks on Nori installation
 * @param args - Configuration arguments
 * @param args.installDir - Custom installation directory (optional)
 * @param args.agent - AI agent to use (defaults to claude-code)
 */
export const checkMain = async (args?: {
  installDir?: string | null;
  agent?: string | null;
}): Promise<void> => {
  const agentName = args?.agent ?? "claude-code";
  // Determine installation directory
  let installDir: string;

  if (args?.installDir != null && args.installDir !== "") {
    // Explicit install dir provided - use it directly
    installDir = args.installDir;
  } else {
    // Auto-detect installation
    const installations = getInstallDirs({ currentDir: process.cwd() });
    if (installations.length === 0) {
      error({
        message:
          "No Nori installations found in current directory or parent directories",
      });
      info({
        message:
          "Run 'nori-ai install' to create a new installation, or use --install-dir to specify a location",
      });
      process.exit(1);
    }
    installDir = installations[0]; // Use closest installation
  }

  newline();
  info({ message: "Running Nori Profiles validation checks..." });
  newline();

  let hasErrors = false;

  // Check config
  info({ message: "Checking configuration..." });
  const configResult = await validateConfig({ installDir });
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
  newline();

  // Load config
  const existingConfig = await loadConfig({ installDir });
  const config = existingConfig ?? {
    profile: getDefaultProfile(),
    installDir,
  };

  // Check server connectivity (paid mode only)
  if (isPaidInstall({ config })) {
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
    newline();
  }

  // Run validation for all loaders
  const agentImpl = AgentRegistry.getInstance().get({ name: agentName });
  const registry = agentImpl.getLoaderRegistry();
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

  newline();
  raw({ message: "=".repeat(70) });

  if (hasErrors) {
    error({ message: "Validation completed with errors" });
    process.exit(1);
  } else {
    success({ message: "All validation checks passed!" });
    info({
      message: `Installation mode: ${isPaidInstall({ config }) ? "paid" : "free"}`,
    });
  }
};
