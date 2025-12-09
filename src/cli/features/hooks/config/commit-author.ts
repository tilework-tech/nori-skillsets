/**
 * Commit-author PreToolUse hook
 * Intercepts git commit commands and replaces Claude attribution with Nori
 */

// Type for the stdin JSON from Claude Code
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

// Type for hook output
type HookOutput = {
  hookSpecificOutput: {
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
 * Check if a command is a git commit command
 * @param args - Arguments object
 * @param args.command - The bash command to check
 *
 * @returns True if the command is a git commit command with -m flag
 */
export const isGitCommitCommand = (args: { command: string }): boolean => {
  const { command } = args;
  // Match git commit with optional flags before "commit" (e.g., git -C /path commit)
  return /git\s+(?:.*\s+)?commit.*(-m|--message)/.test(command);
};

/**
 * Replace Claude attribution with Nori attribution in commit message
 * @param args - Arguments object
 * @param args.command - The original git commit command
 *
 * @returns Modified command with Nori attribution
 */
export const replaceAttribution = (args: { command: string }): string => {
  const { command } = args;

  // Pattern to match Claude attribution in heredoc format
  const claudeAttributionPattern =
    /Co-Authored-By:\s*Claude\s*<noreply@anthropic\.com>/gi;

  // First, try to replace existing Claude attribution
  let modifiedCommand = command.replace(
    claudeAttributionPattern,
    "Co-Authored-By: Nori <contact@tilework.tech>",
  );

  // Check if Claude Code URL pattern exists and replace it
  const claudeCodeUrlPattern =
    /🤖\s*Generated\s*with\s*\[Claude Code\]\(https:\/\/claude\.com\/claude-code\)/gi;
  modifiedCommand = modifiedCommand.replace(
    claudeCodeUrlPattern,
    "🤖 Generated with [Nori](https://nori.ai)",
  );

  // If there was Claude attribution, return the modified command
  if (modifiedCommand !== command) {
    return modifiedCommand;
  }

  // If no Claude attribution found, we need to add Nori attribution
  // Check if this is a heredoc format (contains EOF)
  if (command.includes("EOF")) {
    // Insert Nori attribution before the closing EOF
    const eofPattern = /(EOF\s*\n\s*\))/;
    modifiedCommand = command.replace(
      eofPattern,
      `🤖 Generated with [Nori](https://nori.ai)\n\nCo-Authored-By: Nori <contact@tilework.tech>\nEOF\n)`,
    );
    return modifiedCommand;
  }

  // For simple -m "message" format, we need to append attribution
  // Match the message content within quotes
  const messagePattern = /(-m|--message)\s+(['"])((?:\\.|(?!\2).)*)\2/;
  const match = command.match(messagePattern);

  if (match) {
    const [fullMatch, flag, quote, originalMessage] = match;
    const newMessage = `${originalMessage}\\n\\n🤖 Generated with [Nori](https://nori.ai)\\n\\nCo-Authored-By: Nori <contact@tilework.tech>`;
    modifiedCommand = command.replace(
      fullMatch,
      `${flag} ${quote}${newMessage}${quote}`,
    );
  }

  return modifiedCommand;
};

/**
 * Main hook function
 */
const main = async (): Promise<void> => {
  // Read stdin
  const chunks: Array<Buffer> = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  const inputStr = Buffer.concat(chunks).toString("utf-8");

  // Parse input JSON
  let input: HookInput;
  try {
    if (!inputStr.trim()) {
      // Empty stdin - pass through
      process.exit(0);
    }
    input = JSON.parse(inputStr);
  } catch {
    // Invalid JSON - pass through
    process.exit(0);
  }

  const { tool_name, tool_input } = input;

  // Only process Bash tool calls
  if (tool_name !== "Bash") {
    process.exit(0);
  }

  const command = tool_input.command;

  if (!command) {
    // No command - pass through
    process.exit(0);
  }

  // Check if this is a git commit command
  if (!isGitCommitCommand({ command })) {
    // Not a git commit - pass through
    process.exit(0);
  }

  // Replace attribution
  const modifiedCommand = replaceAttribution({ command });

  // Return modified command
  const output: HookOutput = {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      permissionDecisionReason:
        "Automatically replacing Claude Code attribution with Nori attribution",
      updatedInput: {
        ...tool_input,
        command: modifiedCommand,
      },
    },
  };

  console.log(JSON.stringify(output));
  process.exit(0);
};

main().catch(() => {
  // Unexpected error - pass through silently
  process.exit(0);
});
