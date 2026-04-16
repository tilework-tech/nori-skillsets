/**
 * Verifies that command handlers in the nori-skillsets CLI are loaded lazily:
 * a handler module is only present in Node's module graph when its command is
 * actually invoked. Runs the built CLI in a child Node process with an ESM
 * loader hook that records every loaded module URL to a trace file, then
 * asserts on the trace contents.
 */

import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { describe, it, expect } from "vitest";

const REPO_ROOT = process.cwd();
const CLI_PATH = path.join(REPO_ROOT, "build/src/cli/nori-skillsets.js");
const TRACER_ENTRY = path.join(
  REPO_ROOT,
  "tests/helpers/registerModuleLoadTracer.mjs",
);

const runCliAndGetTrace = (args: {
  cliArgs: Array<string>;
  homeDir?: string | null;
  cwd?: string | null;
}): string => {
  const { cliArgs, homeDir, cwd } = args;
  const traceFile = path.join(
    os.tmpdir(),
    `nori-trace-${process.pid}-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}.log`,
  );
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    FORCE_COLOR: "0",
    NORI_LOAD_TRACE: traceFile,
  };
  if (homeDir != null) {
    env.HOME = homeDir;
    env.NORI_GLOBAL_CONFIG = homeDir;
  }
  try {
    execFileSync("node", ["--import", TRACER_ENTRY, CLI_PATH, ...cliArgs], {
      encoding: "utf-8",
      stdio: "pipe",
      env,
      cwd: cwd ?? process.cwd(),
    });
  } catch {
    // Some invocations exit non-zero (e.g., commands that need a real config).
    // We only care about the trace contents, which are written before exit.
  }
  const trace = fs.existsSync(traceFile)
    ? fs.readFileSync(traceFile, "utf-8")
    : "";
  if (fs.existsSync(traceFile)) {
    fs.rmSync(traceFile, { force: true });
  }
  return trace;
};

describe("nori-skillsets CLI lazy command loading", () => {
  it("does not load any heavy handler module when running --version", () => {
    const trace = runCliAndGetTrace({ cliArgs: ["--version"] });
    const forbidden = [
      /commands\/login\/login\.js/,
      /commands\/registry-search\/registrySearch\.js/,
      /commands\/registry-download\/registryDownload\.js/,
      /commands\/registry-upload\/registryUpload\.js/,
      /commands\/registry-install\/registryInstall\.js/,
    ];
    for (const re of forbidden) {
      expect(trace, `unexpected load matching ${re}`).not.toMatch(re);
    }
  });

  it("executes the listActive handler when running list-active", () => {
    const isolatedDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "nori-lazy-loading-home-"),
    );
    try {
      const trace = runCliAndGetTrace({
        cliArgs: ["list-active"],
        homeDir: isolatedDir,
        cwd: isolatedDir,
      });
      expect(trace).toMatch(/commands\/list-active\/listActive\.js/);
    } finally {
      fs.rmSync(isolatedDir, { recursive: true, force: true });
    }
  });
});
