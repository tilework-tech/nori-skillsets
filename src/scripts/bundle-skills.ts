#!/usr/bin/env node

// Paid Skills Bundler - See bundle-skills-README.md for full documentation

import { readFileSync } from "fs";

import { build } from "esbuild";
import { glob } from "glob";

/**
 * Bundle a single skill script
 *
 * @param args - Bundle arguments
 * @param args.scriptPath - Path to the compiled script.js file
 */
const bundleSkill = async (args: { scriptPath: string }): Promise<void> => {
  const { scriptPath } = args;

  console.log(`Bundling: ${scriptPath}`);

  // Read package version for build-time injection
  const packageJson = JSON.parse(readFileSync("package.json", "utf-8"));
  const packageVersion = packageJson.version;

  try {
    // Bundle with esbuild
    await build({
      entryPoints: [scriptPath],
      bundle: true,
      platform: "node",
      target: "node18",
      format: "esm",
      outfile: scriptPath, // Replace original file
      allowOverwrite: true, // Allow overwriting the input file
      // Don't add banner - the source files already have shebangs
      // Don't bundle these - they should be available in the installed environment
      external: [],
      // Minification is optional - disabled for easier debugging
      minify: false,
      sourcemap: false,
      // Inject package version as compile-time constant
      define: {
        __PACKAGE_VERSION__: JSON.stringify(packageVersion),
      },
    });

    // Make the bundled script executable
    const fs = await import("fs");
    await fs.promises.chmod(scriptPath, 0o755);

    console.log(`✓ Bundled: ${scriptPath}`);
  } catch (error) {
    console.error(`✗ Failed to bundle ${scriptPath}:`, error);
    throw error;
  }
};

/**
 * Main execution function
 */
const main = async (): Promise<void> => {
  console.log("=".repeat(60));
  console.log("Bundling Paid Skill Scripts and Hook Scripts");
  console.log("=".repeat(60));

  // Find all paid skill script files in the build output across all tier-specific mixins
  // Patterns:
  // - build/src/cli/features/claude-code/profiles/config/_mixins/_paid/skills/paid-*/script.js
  // - build/src/cli/features/claude-code/profiles/config/_mixins/_docs-paid/skills/paid-*/script.js
  // - build/src/cli/features/claude-code/profiles/config/_mixins/_docs-paid/skills/nori-sync-docs/script.js (special case: not paid- prefixed)
  const skillPatterns = [
    "build/src/cli/features/claude-code/profiles/config/_mixins/_paid/skills/paid-*/script.js",
    "build/src/cli/features/claude-code/profiles/config/_mixins/_docs-paid/skills/paid-*/script.js",
    "build/src/cli/features/claude-code/profiles/config/_mixins/_docs-paid/skills/nori-sync-docs/script.js",
  ];

  const skillFilesArrays = await Promise.all(
    skillPatterns.map((pattern) =>
      glob(pattern, {
        cwd: process.cwd(),
        absolute: true,
      }),
    ),
  );

  const skillFiles = skillFilesArrays.flat();

  // Find all hook script files in the build output
  // Pattern: build/src/cli/features/claude-code/hooks/config/*.js (excluding test files)
  const hookFiles = await glob(
    "build/src/cli/features/claude-code/hooks/config/*.js",
    {
      cwd: process.cwd(),
      absolute: true,
    },
  );

  // Filter out test files from hooks
  const filteredHookFiles = hookFiles.filter(
    (file: string) => !file.endsWith(".test.js"),
  );

  const allFiles = [...skillFiles, ...filteredHookFiles];

  if (allFiles.length === 0) {
    console.warn("⚠ No scripts found to bundle");
    console.warn("Expected patterns:");
    console.warn(
      "  - build/src/cli/features/claude-code/profiles/config/_mixins/_paid/skills/paid-*/script.js",
    );
    console.warn(
      "  - build/src/cli/features/claude-code/profiles/config/_mixins/_docs-paid/skills/paid-*/script.js",
    );
    console.warn(
      "  - build/src/cli/features/claude-code/profiles/config/_mixins/_docs-paid/skills/nori-sync-docs/script.js",
    );
    console.warn("  - build/src/cli/features/claude-code/hooks/config/*.js");
    return;
  }

  console.log(`Found ${skillFiles.length} skill script(s) to bundle`);
  console.log(`Found ${filteredHookFiles.length} hook script(s) to bundle`);
  console.log(`Total: ${allFiles.length} script(s)\n`);

  // Bundle each script
  for (const scriptPath of allFiles) {
    await bundleSkill({ scriptPath });
  }

  console.log("\n" + "=".repeat(60));
  console.log(
    `✓ Successfully bundled ${allFiles.length} script(s) (${skillFiles.length} skills, ${filteredHookFiles.length} hooks)`,
  );
  console.log("=".repeat(60));
};

// Execute if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: Error) => {
    console.error("Bundling failed:", error);
    process.exit(1);
  });
}

export { bundleSkill, main };
