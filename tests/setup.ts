import * as fs from "fs";
import * as path from "path";

import { afterAll, afterEach, beforeAll, vi } from "vitest";

/**
 * Detect Nori installation pollution in a directory
 * @param cwdPath - Directory path to check for pollution
 *
 * @returns Array of specific files/directories that indicate test pollution
 */
export const detectNoriPollution = (cwdPath: string): Array<string> => {
  const pollutionMarkers: Array<string> = [];

  // Check for Nori-specific files in CWD
  // Note: .nori-notifications.log removed - logs now go to /tmp/nori.log
  const noriFiles = [".nori-config.json", ".nori-installed-version"];

  for (const file of noriFiles) {
    const filePath = path.join(cwdPath, file);
    if (fs.existsSync(filePath)) {
      pollutionMarkers.push(file);
    }
  }

  // Check for Nori installation structure in .claude directory
  const claudePath = path.join(cwdPath, ".claude");
  if (fs.existsSync(claudePath)) {
    const noriDirs = ["profiles", "skills", "agents", "commands", "hooks"];

    for (const dir of noriDirs) {
      const dirPath = path.join(claudePath, dir);
      if (fs.existsSync(dirPath)) {
        pollutionMarkers.push(`.claude/${dir}`);
      }
    }

    // Check for Nori-generated CLAUDE.md (contains managed block marker)
    const claudeMdPath = path.join(claudePath, "CLAUDE.md");
    if (fs.existsSync(claudeMdPath)) {
      try {
        const content = fs.readFileSync(claudeMdPath, "utf-8");
        if (content.includes("BEGIN NORI-AI MANAGED BLOCK")) {
          pollutionMarkers.push(".claude/CLAUDE.md");
        }
      } catch {
        // Ignore read errors
      }
    }
  }

  return pollutionMarkers;
};

// Set test environment
beforeAll(() => {
  process.env.NODE_ENV = "test";

  // Pre-test check: Verify CWD is clean (no Nori installation pollution)
  const cwdPath = process.cwd();
  const pollution = detectNoriPollution(cwdPath);

  if (pollution.length > 0) {
    throw new Error(
      `CONTAINMENT BREAK: Nori installation files exist in CWD before tests run!\n` +
        `This indicates test pollution from a previous run.\n` +
        `Polluted files/directories:\n${pollution.map((p) => `  - ${p}`).join("\n")}\n` +
        `Manually remove these files from ${cwdPath}`,
    );
  }
});

// Clean up resources after each test
afterEach(() => {
  // Clear all mocks between tests
  vi.clearAllMocks();
});

// Post-test check: Verify no Nori installation was created in CWD
afterAll(() => {
  const cwdPath = process.cwd();
  const pollution = detectNoriPollution(cwdPath);

  if (pollution.length > 0) {
    throw new Error(
      `CONTAINMENT BREAK: Tests created Nori installation files in CWD!\n` +
        `This means a test leaked installation files outside temp directories.\n` +
        `All integration tests must mock HOME or installDir to point to temp directories.\n` +
        `Leaked files/directories:\n${pollution.map((p) => `  - ${p}`).join("\n")}\n` +
        `Please manually remove these files from ${cwdPath}`,
    );
  }
});
