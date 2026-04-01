import { execSync } from "node:child_process";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "..");

const hasJust = (() => {
  try {
    execSync("just --version", { encoding: "utf-8", stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
})();

const runJust = (args: {
  target: string;
}): { stdout: string; exitCode: number } => {
  const { target } = args;
  try {
    const stdout = execSync(`just ${target}`, {
      cwd: REPO_ROOT,
      encoding: "utf-8",
      timeout: 30_000,
    });
    return { stdout, exitCode: 0 };
  } catch (err: unknown) {
    const execErr = err as { stdout?: string; status?: number };
    return {
      stdout: (execErr.stdout as string) ?? "",
      exitCode: execErr.status ?? 1,
    };
  }
};

describe.skipIf(!hasJust)("justfile targets", () => {
  it("should have all required targets listed in just --summary", () => {
    const { stdout } = runJust({ target: "--summary" });
    const targets = stdout.trim().split(/\s+/);

    expect(targets).toContain("help");
    expect(targets).toContain("dev");
    expect(targets).toContain("test");
    expect(targets).toContain("doctor");
  });

  describe("just help", () => {
    it("should print repo name, standard targets, and repo-specific targets", () => {
      const { stdout, exitCode } = runJust({ target: "help" });

      expect(exitCode).toBe(0);
      expect(stdout).toContain("skillsets");
      expect(stdout).toContain("dev");
      expect(stdout).toContain("test");
      expect(stdout).toContain("doctor");
      expect(stdout).toContain("lint");
      expect(stdout).toContain("format");
      expect(stdout).toContain("build");
    });
  });

  describe("just doctor", () => {
    it("should check for node and npm availability", () => {
      const { stdout, exitCode } = runJust({ target: "doctor" });

      expect(exitCode).toBe(0);
      expect(stdout.toLowerCase()).toMatch(/node/);
      expect(stdout.toLowerCase()).toMatch(/npm/);
    });
  });
});
