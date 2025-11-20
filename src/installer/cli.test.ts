import { execSync } from "child_process";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

describe("cli default behavior", () => {
  let consoleOutput: Array<string> = [];
  const originalConsoleLog = console.log;

  beforeEach(() => {
    consoleOutput = [];
    console.log = vi.fn((...args: Array<any>) => {
      consoleOutput.push(args.join(" "));
    });
  });

  afterEach(() => {
    console.log = originalConsoleLog;
  });

  it("should show help message when run with no arguments", () => {
    // Execute the CLI with no arguments
    const cliPath = "./build/src/installer/cli.js";
    const result = execSync(`node ${cliPath}`, {
      encoding: "utf-8",
      cwd: process.cwd(),
    });

    // Verify help message is displayed
    expect(result).toContain("Usage: nori-ai [command] [options]");
    expect(result).toContain("Commands:");
    expect(result).toContain("install");
    expect(result).toContain("uninstall");
    expect(result).toContain("help");
  });
});
