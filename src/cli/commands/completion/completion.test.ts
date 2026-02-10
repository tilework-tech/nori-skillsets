import { execSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, vi, beforeEach } from "vitest";

import { generateBashCompletion } from "./bashCompletion.js";
import { completionMain } from "./completion.js";
import { generateZshCompletion } from "./zshCompletion.js";

// Mock logger to capture output
const mockRaw = vi.fn();
const mockError = vi.fn();
vi.mock("@/cli/logger.js", () => ({
  raw: (args: { message: string }) => mockRaw(args),
  error: (args: { message: string }) => mockError(args),
}));

// Mock process.exit
const mockExit = vi
  .spyOn(process, "exit")
  .mockImplementation(() => undefined as never);

const VISIBLE_SUBCOMMANDS = [
  "login",
  "logout",
  "init",
  "search",
  "download",
  "install",
  "switch-skillset",
  "list-skillsets",
  "download-skill",
  "external",
  "watch",
  "dir",
  "fork",
  "edit-skillset",
  "install-location",
  "factory-reset",
  "completion",
  "help",
];

const HIDDEN_ALIASES = [
  "switch-skillsets",
  "switch",
  "list-skillset",
  "fork-skillset",
  "edit",
];

const GLOBAL_FLAGS = [
  "--install-dir",
  "--non-interactive",
  "--silent",
  "--agent",
  "--experimental-ui",
];

describe("generateBashCompletion", () => {
  it("should register completion for all three binary names", () => {
    const result = generateBashCompletion();
    expect(result).toContain("complete");
    expect(result).toContain("nori-skillsets");
    expect(result).toContain("nori-skillset");
    expect(result).toContain("sks");
  });

  it("should contain all visible subcommand names", () => {
    const result = generateBashCompletion();
    for (const cmd of VISIBLE_SUBCOMMANDS) {
      expect(result).toContain(cmd);
    }
  });

  it("should NOT contain hidden aliases", () => {
    const result = generateBashCompletion();
    // The hidden aliases should not appear as standalone completion candidates.
    // They may appear as substrings (e.g., "switch-skillsets" contains "switch-skillset"),
    // so we check that they don't appear in the subcommand word list.
    // The subcommand list is used in compgen -W, so check that the plural/singular
    // aliases are not in that list.
    for (const alias of HIDDEN_ALIASES) {
      // Match the alias as a whole word in the commands string
      const commandsListMatch = result.match(/commands="([^"]*)"/);
      if (commandsListMatch) {
        const commandsList = commandsListMatch[1].split(/\s+/);
        expect(commandsList).not.toContain(alias);
      }
    }
  });

  it("should contain all global flags", () => {
    const result = generateBashCompletion();
    for (const flag of GLOBAL_FLAGS) {
      expect(result).toContain(flag);
    }
  });

  it("should contain login-specific flags", () => {
    const result = generateBashCompletion();
    expect(result).toContain("--email");
    expect(result).toContain("--password");
    expect(result).toContain("--google");
    expect(result).toContain("--no-localhost");
  });

  it("should contain download-specific flags", () => {
    const result = generateBashCompletion();
    expect(result).toContain("--registry");
    expect(result).toContain("--list-versions");
  });

  it("should contain external-specific flags", () => {
    const result = generateBashCompletion();
    expect(result).toContain("--skillset");
    expect(result).toContain("--skill");
    expect(result).toContain("--all");
    expect(result).toContain("--ref");
  });

  it("should contain edit-skillset-specific flags", () => {
    const result = generateBashCompletion();
    // edit-skillset should offer --agent flag
    expect(result).toMatch(/edit-skillset[\s\S]*--agent/);
  });

  it("should contain install-location-specific flags", () => {
    const result = generateBashCompletion();
    expect(result).toContain("--installation-source");
    expect(result).toContain("--installation-managed");
  });

  it("should reference list-skillsets for dynamic switch-skillset completion", () => {
    const result = generateBashCompletion();
    expect(result).toContain("list-skillsets");
    // Should be used in the switch-skillset case for dynamic completion
    expect(result).toMatch(
      /switch-skillset.*list-skillsets|list-skillsets.*switch-skillset/s,
    );
  });

  it("should include stop subcommand for watch", () => {
    const result = generateBashCompletion();
    expect(result).toContain("stop");
  });

  it("should generate syntactically valid bash", () => {
    const result = generateBashCompletion();
    const tmpFile = path.join(
      os.tmpdir(),
      `nori-bash-completion-test-${Date.now()}.sh`,
    );
    try {
      fs.writeFileSync(tmpFile, result);
      execSync(`bash -n "${tmpFile}"`, { stdio: "pipe" });
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });
});

describe("generateZshCompletion", () => {
  it("should register completion for all three binary names via compdef", () => {
    const result = generateZshCompletion();
    expect(result).toContain("compdef");
    expect(result).toContain("nori-skillsets");
    expect(result).toContain("nori-skillset");
    expect(result).toContain("sks");
  });

  it("should contain all visible subcommand names", () => {
    const result = generateZshCompletion();
    for (const cmd of VISIBLE_SUBCOMMANDS) {
      expect(result).toContain(cmd);
    }
  });

  it("should NOT contain hidden aliases", () => {
    const result = generateZshCompletion();
    // Check that hidden aliases don't appear as standalone completion candidates
    // by verifying they aren't in the commands array
    for (const alias of HIDDEN_ALIASES) {
      // The zsh script uses a commands array — check the alias isn't a standalone entry
      const lines = result.split("\n");
      const commandLines = lines.filter(
        (line) =>
          line.includes("'") && line.includes(":") && line.includes("["),
      );
      for (const line of commandLines) {
        // Each line like "'login:Authenticate with noriskillsets.dev'"
        // should not start with the hidden alias name
        if (line.trim().startsWith(`'${alias}:`)) {
          expect.fail(
            `Hidden alias "${alias}" found in zsh completion commands`,
          );
        }
      }
    }
  });

  it("should contain all global flags", () => {
    const result = generateZshCompletion();
    for (const flag of GLOBAL_FLAGS) {
      expect(result).toContain(flag);
    }
  });

  it("should contain command-specific flags for key commands", () => {
    const result = generateZshCompletion();
    // login flags
    expect(result).toContain("--email");
    expect(result).toContain("--password");
    expect(result).toContain("--google");
    expect(result).toContain("--no-localhost");
    // download flags
    expect(result).toContain("--registry");
    expect(result).toContain("--list-versions");
    // external flags
    expect(result).toContain("--skillset");
    expect(result).toContain("--skill");
    expect(result).toContain("--all");
    expect(result).toContain("--ref");
    // install-location flags
    expect(result).toContain("--installation-source");
    expect(result).toContain("--installation-managed");
  });

  it("should reference list-skillsets for dynamic switch-skillset completion", () => {
    const result = generateZshCompletion();
    expect(result).toContain("list-skillsets");
  });

  it("should include stop subcommand for watch", () => {
    const result = generateZshCompletion();
    expect(result).toContain("stop");
  });

  it("should generate syntactically valid zsh", () => {
    let hasZsh = false;
    try {
      execSync("which zsh", { stdio: "pipe" });
      hasZsh = true;
    } catch {
      // zsh not available
    }
    if (!hasZsh) {
      return;
    }
    const result = generateZshCompletion();
    const tmpFile = path.join(
      os.tmpdir(),
      `nori-zsh-completion-test-${Date.now()}.zsh`,
    );
    try {
      fs.writeFileSync(tmpFile, result);
      execSync(`zsh -n "${tmpFile}"`, { stdio: "pipe" });
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });
});

describe("completionMain", () => {
  beforeEach(() => {
    mockRaw.mockClear();
    mockError.mockClear();
    mockExit.mockClear();
  });

  it("should output bash completion script when shell is bash", () => {
    completionMain({ shell: "bash" });
    expect(mockRaw).toHaveBeenCalledTimes(1);
    const output = mockRaw.mock.calls[0][0].message;
    expect(output).toContain("complete");
    expect(output).toContain("nori-skillsets");
  });

  it("should output zsh completion script when shell is zsh", () => {
    completionMain({ shell: "zsh" });
    expect(mockRaw).toHaveBeenCalledTimes(1);
    const output = mockRaw.mock.calls[0][0].message;
    expect(output).toContain("compdef");
    expect(output).toContain("nori-skillsets");
  });

  it("should error and exit 1 for unsupported shell", () => {
    completionMain({ shell: "fish" });
    expect(mockError).toHaveBeenCalledTimes(1);
    expect(mockError).toHaveBeenCalledWith({
      message: expect.stringContaining("fish"),
    });
    expect(mockExit).toHaveBeenCalledWith(1);
  });
});
