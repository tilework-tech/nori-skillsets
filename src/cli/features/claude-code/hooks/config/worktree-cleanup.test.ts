/**
 * Tests for worktree cleanup warning hook
 *
 * This hook warns users when system disk space is low (<10% free) and
 * git worktrees exist.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { main } from "./worktree-cleanup.js";

// Store console output
let consoleOutput: Array<string> = [];
const originalConsoleLog = console.log;

// Mock analytics to prevent actual tracking
vi.mock("@/cli/analytics.js", () => ({
  trackEvent: vi.fn().mockResolvedValue(undefined),
}));

describe("worktree-cleanup hook", () => {
  let tempDir: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    // Create temp directory for test
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "worktree-cleanup-test-"));

    // Mock HOME
    originalHome = process.env.HOME;
    process.env.HOME = tempDir;

    // Capture console output
    consoleOutput = [];
    console.log = (...args: Array<unknown>) => {
      consoleOutput.push(args.map(String).join(" "));
    };
  });

  afterEach(() => {
    // Restore HOME
    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }

    // Restore console
    console.log = originalConsoleLog;

    // Clean up temp directory
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("should output nothing when not in a git repo", async () => {
    // Setup: Create a directory that is not a git repo
    const nonGitDir = path.join(tempDir, "not-a-git-repo");
    fs.mkdirSync(nonGitDir, { recursive: true });

    // Run the hook
    await main({ cwd: nonGitDir });

    // Verify no output
    expect(consoleOutput).toHaveLength(0);
  });

  it("should output nothing when no additional worktrees exist", async () => {
    // Setup: Create a git repo with no additional worktrees
    const gitDir = path.join(tempDir, "git-repo");
    fs.mkdirSync(gitDir, { recursive: true });

    // Initialize git repo
    const { execSync } = await import("child_process");
    execSync("git init", { cwd: gitDir, stdio: "ignore" });
    execSync("git config user.email 'test@test.com'", {
      cwd: gitDir,
      stdio: "ignore",
    });
    execSync("git config user.name 'Test'", { cwd: gitDir, stdio: "ignore" });
    fs.writeFileSync(path.join(gitDir, "README.md"), "# Test");
    execSync("git add .", { cwd: gitDir, stdio: "ignore" });
    execSync("git commit -m 'init'", { cwd: gitDir, stdio: "ignore" });

    // Run the hook
    await main({ cwd: gitDir });

    // Verify no output (only main worktree exists)
    expect(consoleOutput).toHaveLength(0);
  });

  it("should output nothing when worktrees exist and disk space is sufficient", async () => {
    // Setup: Create a git repo with a small worktree
    const gitDir = path.join(tempDir, "git-repo");
    const worktreeDir = path.join(tempDir, "worktree-1");
    fs.mkdirSync(gitDir, { recursive: true });

    // Initialize git repo
    const { execSync } = await import("child_process");
    execSync("git init", { cwd: gitDir, stdio: "ignore" });
    execSync("git config user.email 'test@test.com'", {
      cwd: gitDir,
      stdio: "ignore",
    });
    execSync("git config user.name 'Test'", { cwd: gitDir, stdio: "ignore" });
    fs.writeFileSync(path.join(gitDir, "README.md"), "# Test");
    execSync("git add .", { cwd: gitDir, stdio: "ignore" });
    execSync("git commit -m 'init'", { cwd: gitDir, stdio: "ignore" });

    // Create a worktree
    execSync(`git worktree add "${worktreeDir}" -b test-branch`, {
      cwd: gitDir,
      stdio: "ignore",
    });

    // Run the hook (disk space should be sufficient on test machine)
    await main({ cwd: gitDir });

    // Verify no output
    expect(consoleOutput).toHaveLength(0);

    // Cleanup worktree
    execSync(`git worktree remove "${worktreeDir}"`, {
      cwd: gitDir,
      stdio: "ignore",
    });
  });

  it("should not throw errors and exit gracefully on invalid paths", async () => {
    // Setup: Invalid cwd that doesn't exist
    const invalidDir = path.join(tempDir, "nonexistent", "path", "deep");

    // Run the hook - should not throw
    await expect(main({ cwd: invalidDir })).resolves.not.toThrow();

    // Hook should exit gracefully with no output
    expect(consoleOutput).toHaveLength(0);
  });
});
