/**
 * User prompt utilities for installer
 * Shared functions for prompting user for input
 */

import * as readline from "readline";

/**
 * Prompt user for input
 * @param args - Configuration arguments
 * @param args.prompt - Prompt text to display
 * @param args.hidden - Whether to hide input completely (for passwords)
 * @param args.masked - Whether to show stars for each character (for tokens)
 *
 * @returns User's input as a string
 */
export const promptUser = async (args: {
  prompt: string;
  hidden?: boolean | null;
  masked?: boolean | null;
}): Promise<string> => {
  const { prompt, hidden, masked } = args;

  if (hidden || masked) {
    // Hidden/masked password input - use raw mode without readline
    const stdin = process.stdin;

    // Write prompt FIRST, before entering raw mode
    process.stdout.write(prompt);

    // Resume stdin to ensure it's actively reading
    stdin.resume();

    // THEN enter raw mode
    (stdin as any).setRawMode?.(true);
    stdin.setEncoding("utf8");

    let password = "";

    return new Promise((resolve) => {
      const onData = (char: string) => {
        if (char === "\r" || char === "\n") {
          // Enter - clean up and resolve
          stdin.removeListener("data", onData);
          (stdin as any).setRawMode?.(false);
          stdin.pause();
          process.stdout.write("\n");
          resolve(password);
        } else if (char === "\u0003") {
          // Ctrl+C - clean up and exit
          stdin.removeListener("data", onData);
          (stdin as any).setRawMode?.(false);
          process.exit(1);
        } else if (char === "\u007f") {
          // Backspace - remove last character
          if (password.length > 0) {
            password = password.slice(0, -1);
            if (masked) {
              // Erase the star from terminal: move cursor back, write space, move back again
              process.stdout.write("\b \b");
            }
          }
        } else {
          // Regular character - add to password
          password += char;
          if (masked) {
            // Show a star for each character
            process.stdout.write("*");
          }
        }
      };

      stdin.on("data", onData);
    });
  } else {
    // Normal input - use readline
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    return new Promise((resolve) => {
      rl.question(prompt, (answer) => {
        rl.close();
        resolve(answer);
      });
    });
  }
};

/**
 * Prompt user for yes/no confirmation
 * @param args - Configuration arguments
 * @param args.prompt - Prompt text to display (will append " (y/n): ")
 * @param args.defaultValue - Default value if user just presses enter
 *
 * @returns true for yes, false for no
 */
export const promptYesNo = async (args: {
  prompt: string;
  defaultValue?: boolean | null;
}): Promise<boolean> => {
  const { prompt, defaultValue } = args;

  const suffix =
    defaultValue === true
      ? " (Y/n): "
      : defaultValue === false
        ? " (y/N): "
        : " (y/n): ";

  const response = await promptUser({ prompt: prompt + suffix });
  const normalized = response.trim().toLowerCase();

  if (normalized === "") {
    return defaultValue ?? false;
  }

  return normalized === "y" || normalized === "yes";
};
