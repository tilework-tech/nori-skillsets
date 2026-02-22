/**
 * Tests for the prepublishOnly safeguard.
 *
 * The prepublishOnly script should prevent accidental `npm publish` and
 * direct users to use create_skillsets_release.py instead.
 */

import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

import { describe, it, expect } from "vitest";

describe("prepublishOnly safeguard", () => {
  const projectRoot = process.cwd();

  it("should reject direct npm publish with a helpful error message", () => {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(projectRoot, "package.json"), "utf-8"),
    );
    const script = packageJson.scripts.prepublishOnly;
    expect(script).toBeDefined();

    // Run the prepublishOnly command and expect it to fail
    let output = "";
    try {
      execSync(script, {
        cwd: projectRoot,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      });
      // If it doesn't throw, the test fails
      expect.unreachable("prepublishOnly should exit with non-zero");
    } catch (error: unknown) {
      const execError = error as { status: number; stderr: string };
      expect(execError.status).not.toBe(0);
      output = execError.stderr;
    }

    expect(output).toContain("Do not run 'npm publish' directly");
    expect(output).toContain("create_skillsets_release.py");
  });
});
