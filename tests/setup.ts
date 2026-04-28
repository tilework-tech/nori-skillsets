import { execSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { afterAll, afterEach, beforeAll, vi } from "vitest";

// Store isolated test home directory
let testHomeDir: string | null = null;

// Store original HOME value for restoration
let originalHome: string | undefined;

// Snapshot of pre-existing pollution so we only flag NEW pollution in afterAll
let preExistingPollution: Set<string> = new Set();

/**
 * Check if a file is tracked by git
 * @param args - Function arguments
 * @param args.filePath - Relative path to the file
 * @param args.cwd - Working directory for the git command
 *
 * @returns True if the file is tracked by git
 */
const isGitTracked = (args: { filePath: string; cwd: string }): boolean => {
  const { filePath, cwd } = args;
  try {
    const result = execSync(`git ls-files -- "${filePath}"`, {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return result.trim().length > 0;
  } catch {
    return false;
  }
};

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
  const noriFiles = [".nori-config.json"];

  for (const file of noriFiles) {
    const filePath = path.join(cwdPath, file);
    if (
      fs.existsSync(filePath) &&
      !isGitTracked({ filePath: file, cwd: cwdPath })
    ) {
      pollutionMarkers.push(file);
    }
  }

  // Check for Nori installation structure in .claude directory
  const claudePath = path.join(cwdPath, ".claude");
  if (fs.existsSync(claudePath)) {
    const noriDirs = ["profiles", "skills", "agents", "commands", "hooks"];

    for (const dir of noriDirs) {
      const dirPath = path.join(claudePath, dir);
      if (
        fs.existsSync(dirPath) &&
        !isGitTracked({ filePath: `.claude/${dir}`, cwd: cwdPath })
      ) {
        pollutionMarkers.push(`.claude/${dir}`);
      }
    }

    // Check for Nori-generated CLAUDE.md (contains managed block marker)
    const claudeMdPath = path.join(claudePath, "CLAUDE.md");
    if (
      fs.existsSync(claudeMdPath) &&
      !isGitTracked({ filePath: ".claude/CLAUDE.md", cwd: cwdPath })
    ) {
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

  // Store original HOME for restoration
  originalHome = process.env.HOME;

  // Create isolated temp directory for HOME
  testHomeDir = fs.mkdtempSync(path.join(os.tmpdir(), "nori-test-home-"));

  // Create expected directory structure
  fs.mkdirSync(path.join(testHomeDir, ".nori", "profiles"), {
    recursive: true,
  });
  fs.mkdirSync(path.join(testHomeDir, ".claude"), { recursive: true });

  // Set HOME for isolation - getHomeDir() checks NORI_GLOBAL_CONFIG first, then HOME
  // Individual tests can override HOME to use their own temp directories
  process.env.HOME = testHomeDir;

  // Snapshot pre-existing pollution so afterAll only flags NEW pollution.
  // This handles the case where nori is installed in CWD (e.g., worktrees).
  const cwdPath = process.cwd();
  preExistingPollution = new Set(detectNoriPollution(cwdPath));
  if (preExistingPollution.size > 0) {
    console.warn(
      `[test-setup] Pre-existing nori artifacts in CWD (will be ignored): ${[...preExistingPollution].join(", ")}`,
    );
  }
});

// Clean up resources after each test
afterEach(() => {
  // Clear all mocks between tests
  vi.clearAllMocks();
});

// Post-test check: Verify no NEW Nori installation was created in CWD
afterAll(() => {
  const cwdPath = process.cwd();
  const newPollution = detectNoriPollution(cwdPath).filter(
    (p) => !preExistingPollution.has(p),
  );

  if (newPollution.length > 0) {
    throw new Error(
      `CONTAINMENT BREAK: Tests created Nori installation files in CWD!\n` +
        `This means a test leaked installation files outside temp directories.\n` +
        `All integration tests must mock HOME or installDir to point to temp directories.\n` +
        `Leaked files/directories:\n${newPollution.map((p) => `  - ${p}`).join("\n")}\n` +
        `Please manually remove these files from ${cwdPath}`,
    );
  }

  // Clean up test home directory
  if (testHomeDir != null) {
    try {
      fs.rmSync(testHomeDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
    testHomeDir = null;
  }

  // Restore original HOME
  if (originalHome !== undefined) {
    process.env.HOME = originalHome;
  } else {
    delete process.env.HOME;
  }
});
