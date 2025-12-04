/**
 * Tests for commit-author PreToolUse hook
 */

import { spawn } from "child_process";
import * as path from "path";
import { fileURLToPath } from "url";

import { describe, it, expect } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type HookInput = {
  session_id: string;
  transcript_path: string;
  cwd: string;
  permission_mode: string;
  hook_event_name: string;
  tool_name: string;
  tool_input: {
    command?: string;
    [key: string]: any;
  };
  tool_use_id: string;
};

type HookOutput = {
  hookSpecificOutput?: {
    hookEventName: string;
    permissionDecision: "allow" | "deny" | "ask";
    permissionDecisionReason?: string;
    updatedInput?: {
      command?: string;
      [key: string]: any;
    };
  };
};

/**
 * Run the hook script with given input
 * @param args - Arguments object
 * @param args.input - Hook input JSON
 *
 * @returns Hook output JSON and exit code
 */
const runHook = async (args: {
  input: HookInput;
}): Promise<{
  output: HookOutput | null;
  exitCode: number;
  stderr: string;
}> => {
  const { input } = args;

  // Path to the compiled hook script in build directory
  const hookScript = path.resolve(
    __dirname,
    "../../../../../build/src/installer/features/hooks/config/commit-author.js",
  );

  return new Promise((resolve) => {
    const proc = spawn("node", [hookScript], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      let output: HookOutput | null = null;
      if (stdout.trim()) {
        try {
          output = JSON.parse(stdout);
        } catch {
          // Invalid JSON output
        }
      }
      resolve({ output, exitCode: code ?? 0, stderr });
    });

    // Write input to stdin
    proc.stdin.write(JSON.stringify(input));
    proc.stdin.end();
  });
};

describe("commit-author hook", () => {
  it("should pass through non-Bash tools unchanged", async () => {
    const input: HookInput = {
      session_id: "test-session",
      transcript_path: "/tmp/test.jsonl",
      cwd: "/tmp",
      permission_mode: "default",
      hook_event_name: "PreToolUse",
      tool_name: "Write",
      tool_input: {
        file_path: "/tmp/test.txt",
        content: "test content",
      },
      tool_use_id: "toolu_123",
    };

    const { output, exitCode } = await runHook({ input });

    expect(exitCode).toBe(0);
    expect(output).toBeNull();
  });

  it("should pass through non-git-commit Bash commands unchanged", async () => {
    const input: HookInput = {
      session_id: "test-session",
      transcript_path: "/tmp/test.jsonl",
      cwd: "/tmp",
      permission_mode: "default",
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: {
        command: "ls -la",
      },
      tool_use_id: "toolu_123",
    };

    const { output, exitCode } = await runHook({ input });

    expect(exitCode).toBe(0);
    expect(output).toBeNull();
  });

  it("should detect git commit commands with -m flag", async () => {
    const input: HookInput = {
      session_id: "test-session",
      transcript_path: "/tmp/test.jsonl",
      cwd: "/tmp",
      permission_mode: "default",
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: {
        command: 'git commit -m "fix: bug"',
      },
      tool_use_id: "toolu_123",
    };

    const { output, exitCode } = await runHook({ input });

    expect(exitCode).toBe(0);
    expect(output).not.toBeNull();
    expect(output?.hookSpecificOutput?.hookEventName).toBe("PreToolUse");
    expect(output?.hookSpecificOutput?.permissionDecision).toBe("allow");
  });

  it("should modify commit message to include Nori attribution", async () => {
    const input: HookInput = {
      session_id: "test-session",
      transcript_path: "/tmp/test.jsonl",
      cwd: "/tmp",
      permission_mode: "default",
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: {
        command: 'git commit -m "fix: bug"',
      },
      tool_use_id: "toolu_123",
    };

    const { output, exitCode } = await runHook({ input });

    expect(exitCode).toBe(0);
    expect(output?.hookSpecificOutput?.updatedInput?.command).toContain(
      "Co-Authored-By: Nori <contact@tilework.tech>",
    );
    expect(output?.hookSpecificOutput?.updatedInput?.command).toContain(
      "🤖 Generated with [Nori](https://nori.ai)",
    );
  });

  it("should preserve original commit message structure", async () => {
    const input: HookInput = {
      session_id: "test-session",
      transcript_path: "/tmp/test.jsonl",
      cwd: "/tmp",
      permission_mode: "default",
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: {
        command: 'git commit -m "fix: resolve authentication bug"',
      },
      tool_use_id: "toolu_123",
    };

    const { output, exitCode } = await runHook({ input });

    expect(exitCode).toBe(0);
    const modifiedCommand =
      output?.hookSpecificOutput?.updatedInput?.command || "";

    // Original message should be preserved
    expect(modifiedCommand).toContain("fix: resolve authentication bug");

    // Attribution should be added after the message
    expect(
      modifiedCommand.indexOf("fix: resolve authentication bug"),
    ).toBeLessThan(modifiedCommand.indexOf("Co-Authored-By: Nori"));
  });

  it("should handle git commit commands with additional flags", async () => {
    const input: HookInput = {
      session_id: "test-session",
      transcript_path: "/tmp/test.jsonl",
      cwd: "/tmp",
      permission_mode: "default",
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: {
        command: 'git commit -a -s -m "fix: bug"',
      },
      tool_use_id: "toolu_123",
    };

    const { output, exitCode } = await runHook({ input });

    expect(exitCode).toBe(0);
    const modifiedCommand =
      output?.hookSpecificOutput?.updatedInput?.command || "";

    // Should preserve -a and -s flags
    expect(modifiedCommand).toContain("-a");
    expect(modifiedCommand).toContain("-s");

    // Should still add Nori attribution
    expect(modifiedCommand).toContain(
      "Co-Authored-By: Nori <contact@tilework.tech>",
    );
  });

  it("should handle single-quoted commit messages", async () => {
    const input: HookInput = {
      session_id: "test-session",
      transcript_path: "/tmp/test.jsonl",
      cwd: "/tmp",
      permission_mode: "default",
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: {
        command: "git commit -m 'fix: bug'",
      },
      tool_use_id: "toolu_123",
    };

    const { output, exitCode } = await runHook({ input });

    expect(exitCode).toBe(0);
    const modifiedCommand =
      output?.hookSpecificOutput?.updatedInput?.command || "";

    expect(modifiedCommand).toContain("fix: bug");
    expect(modifiedCommand).toContain(
      "Co-Authored-By: Nori <contact@tilework.tech>",
    );
  });

  it("should handle commit messages with heredoc format", async () => {
    const commitMessage = `git commit -m "\$(cat <<'EOF'
feat: Add new feature

This is a longer commit message that spans multiple lines.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"`;

    const input: HookInput = {
      session_id: "test-session",
      transcript_path: "/tmp/test.jsonl",
      cwd: "/tmp",
      permission_mode: "default",
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: {
        command: commitMessage,
      },
      tool_use_id: "toolu_123",
    };

    const { output, exitCode } = await runHook({ input });

    expect(exitCode).toBe(0);
    const modifiedCommand =
      output?.hookSpecificOutput?.updatedInput?.command || "";

    // Should replace Claude attribution with Nori
    expect(modifiedCommand).not.toContain(
      "Co-Authored-By: Claude <noreply@anthropic.com>",
    );
    expect(modifiedCommand).toContain(
      "Co-Authored-By: Nori <contact@tilework.tech>",
    );

    // Should preserve the original message
    expect(modifiedCommand).toContain("feat: Add new feature");
    expect(modifiedCommand).toContain(
      "This is a longer commit message that spans multiple lines.",
    );
  });

  it("should handle git commit with -C flag for specifying directory", async () => {
    const commitMessage = `git -C /home/user/project/.worktrees/feature-branch commit -m "\$(cat <<'EOF'
Add new feature

This commit adds a new feature to the project.
EOF
)"`;

    const input: HookInput = {
      session_id: "test-session",
      transcript_path: "/tmp/test.jsonl",
      cwd: "/tmp",
      permission_mode: "default",
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: {
        command: commitMessage,
      },
      tool_use_id: "toolu_123",
    };

    const { output, exitCode } = await runHook({ input });

    expect(exitCode).toBe(0);
    expect(output).not.toBeNull();
    const modifiedCommand =
      output?.hookSpecificOutput?.updatedInput?.command || "";

    // Should add Nori attribution
    expect(modifiedCommand).toContain(
      "Co-Authored-By: Nori <contact@tilework.tech>",
    );
    expect(modifiedCommand).toContain(
      "🤖 Generated with [Nori](https://nori.ai)",
    );

    // Should preserve original message
    expect(modifiedCommand).toContain("Add new feature");
    expect(modifiedCommand).toContain(
      "This commit adds a new feature to the project.",
    );
  });
});
