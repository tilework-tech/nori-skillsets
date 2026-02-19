/**
 * Prompts text wrapper
 *
 * Provides a wrapper around @clack/prompts text function
 * with consistent cancel handling and validation support.
 */

import { text, isCancel } from "@clack/prompts";

import { handleCancel } from "./utils.js";

/**
 * Validation function type matching the codebase pattern
 * Returns undefined for valid input, or error message string for invalid
 */
type ValidateFunction = (args: { value: string }) => string | undefined;

/**
 * Prompt user for text input
 *
 * @param args - Text input arguments
 * @param args.message - The message to display
 * @param args.placeholder - Optional placeholder text
 * @param args.defaultValue - Optional default value (used when user submits empty)
 * @param args.initialValue - Optional initial value (pre-filled in input)
 * @param args.validate - Optional validation function
 *
 * @returns The user's input string
 */
export const promptText = async (args: {
  message: string;
  placeholder?: string | null;
  defaultValue?: string | null;
  initialValue?: string | null;
  validate?: ValidateFunction | null;
}): Promise<string> => {
  const { message, placeholder, defaultValue, initialValue, validate } = args;

  const options: {
    message: string;
    placeholder?: string;
    defaultValue?: string;
    initialValue?: string;
    validate?: (value: string | undefined) => string | undefined;
  } = { message };

  if (placeholder != null) {
    options.placeholder = placeholder;
  }

  if (defaultValue != null) {
    options.defaultValue = defaultValue;
  }

  if (initialValue != null) {
    options.initialValue = initialValue;
  }

  if (validate != null) {
    options.validate = (value: string | undefined) =>
      validate({ value: value ?? "" });
  }

  const result = await text(options);

  if (isCancel(result)) {
    handleCancel();
  }

  return result as string;
};
