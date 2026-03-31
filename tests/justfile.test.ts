import { execSync } from "node:child_process";
import * as fs from "node:fs";
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
  env?: Record<string, string>;
}): { stdout: string; exitCode: number } => {
  const { target, env } = args;
  try {
    const stdout = execSync(`just ${target}`, {
      cwd: REPO_ROOT,
      encoding: "utf-8",
      env: { ...process.env, ...env },
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
  it("should have all five required targets listed in just --summary", () => {
    const { stdout } = runJust({ target: "--summary" });
    const targets = stdout.trim().split(/\s+/);

    expect(targets).toContain("help");
    expect(targets).toContain("dev");
    expect(targets).toContain("test");
    expect(targets).toContain("doctor");
    expect(targets).toContain("services");
  });

  describe("just help", () => {
    it("should print repo name, standard targets, and repo-specific targets", () => {
      const { stdout, exitCode } = runJust({ target: "help" });

      expect(exitCode).toBe(0);
      expect(stdout).toContain("skillsets");
      expect(stdout).toContain("dev");
      expect(stdout).toContain("test");
      expect(stdout).toContain("doctor");
      expect(stdout).toContain("services");
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

  describe("just services", () => {
    it("should handle missing services file gracefully", () => {
      const { stdout, exitCode } = runJust({
        target: "services",
        env: { NORI_SERVICES_FILE: "/tmp/nonexistent-services-file.yml" },
      });

      // Should not crash — exit 0 with guidance
      expect(exitCode).toBe(0);
      expect(stdout.toLowerCase()).toMatch(
        /not found|does not exist|no services file/,
      );
    });

    it("should display services from the file when it exists", () => {
      const tmpFile = path.join(REPO_ROOT, "tests", ".tmp-local-services.yml");
      const content = [
        "services:",
        "  skillsets-cli:",
        "    repo: skillsets",
        "    cwd: /home/user/nori/skillsets",
        "    role: skillsets cli tool",
        "    start_cmd: npm run dev",
        "  broker-server:",
        "    repo: sessions",
        "    cwd: /home/user/nori/sessions/broker/server",
        "    role: local broker api",
        "    start_cmd: cd broker/server && bun run src/main.ts",
        "    default_port: 3001",
      ].join("\n");

      try {
        fs.writeFileSync(tmpFile, content, "utf-8");
        const { stdout, exitCode } = runJust({
          target: "services",
          env: { NORI_SERVICES_FILE: tmpFile },
        });

        expect(exitCode).toBe(0);
        expect(stdout).toContain("skillsets-cli");
        expect(stdout).toContain("skillsets cli tool");
      } finally {
        if (fs.existsSync(tmpFile)) {
          fs.unlinkSync(tmpFile);
        }
      }
    });
  });
});

describe("local-services.yml seed file", () => {
  const seedPath = path.join(REPO_ROOT, "configs", "local-services.yml");

  it("should exist at configs/local-services.yml", () => {
    expect(fs.existsSync(seedPath)).toBe(true);
  });

  it("should contain required fields for each service entry", () => {
    const content = fs.readFileSync(seedPath, "utf-8");
    const requiredFields = ["repo:", "cwd:", "role:", "start_cmd:"];

    // Find all service blocks (indented names under services:)
    const serviceNames = content
      .match(/^ {2}\w[\w-]*:/gm)
      ?.map((s) => s.trim().replace(":", ""));

    expect(serviceNames).toBeDefined();
    expect(serviceNames!.length).toBeGreaterThan(0);

    // Each service should have all required fields
    const serviceBlocks = content.split(/^ {2}\w[\w-]*:/m).slice(1);
    for (const block of serviceBlocks) {
      for (const field of requiredFields) {
        expect(block).toContain(field);
      }
    }
  });

  it("should include entries for core Nori services", () => {
    const content = fs.readFileSync(seedPath, "utf-8");

    // Verify key services are present
    expect(content).toMatch(/repo:\s*skillsets/);
    expect(content).toMatch(/repo:\s*sessions/);
    expect(content).toMatch(/repo:\s*registrar/);
  });
});
