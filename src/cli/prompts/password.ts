/**
 * Prompts password wrapper
 *
 * Provides a wrapper around @clack/prompts password function
 * with consistent cancel handling.
 */

import { password, isCancel } from "@clack/prompts";

import { handleCancel } from "./utils.js";

/**
 * Prompt user for password input (masked)
 *
 * @param args - Password input arguments
 * @param args.message - The message to display
 * @param args.placeholder - Optional placeholder text
 *
 * @returns The user's password string
 */
export const promptPassword = async (args: {
  message: string;
  placeholder?: string | null;
}): Promise<string> => {
  const { message, placeholder } = args;

  const options: {
    message: string;
    placeholder?: string;
  } = { message };

  if (placeholder != null) {
    options.placeholder = placeholder;
  }

  const result = await password(options);

  if (isCancel(result)) {
    handleCancel();
  }

  return result as string;
};
