/**
 * Slash command intercept hook
 * Intercepts slash commands and executes them directly without LLM inference overhead.
 */

import type { HookInput } from "./intercepted-slashcommands/types.js";

import { interceptedSlashCommands } from "./intercepted-slashcommands/registry.js";

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

  const { prompt, cwd } = input;

  if (!prompt || !cwd) {
    // Missing required fields - pass through
    process.exit(0);
  }

  // Try each registered command
  for (const command of interceptedSlashCommands) {
    // Check if any matcher matches the prompt
    const trimmedPrompt = prompt.trim();
    let matched = false;

    for (const matcher of command.matchers) {
      const regex = new RegExp(matcher, "i");
      if (regex.test(trimmedPrompt)) {
        matched = true;
        break;
      }
    }

    if (matched) {
      // Execute the command
      const result = await command.run({ input });

      if (result != null) {
        console.log(JSON.stringify(result));
      }

      process.exit(0);
    }
  }

  // No matching command - pass through
  process.exit(0);
};

main().catch(() => {
  // Unexpected error - pass through silently
  process.exit(0);
});
