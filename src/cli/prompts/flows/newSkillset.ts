/**
 * New skillset flow module
 *
 * Provides the complete interactive new skillset creation experience using @clack/prompts.
 * This flow handles:
 * - Collecting skillset metadata (name, description, license, keywords, version, repository)
 * - Validating skillset name
 * - Parsing keywords from comma-separated string to array
 */

import { text } from "@clack/prompts";

import { unwrapPrompt } from "@/cli/prompts/flows/utils.js";
import { validateSkillsetName } from "@/cli/prompts/validators.js";

/**
 * Result of the new skillset flow
 */
export type NewSkillsetFlowResult = {
  name: string;
  description: string | null;
  license: string | null;
  keywords: Array<string> | null;
  version: string | null;
  repository: string | null;
  statusMessage: string;
};

/**
 * Parse keywords from comma-separated string to array
 *
 * @param args - Parse arguments
 * @param args.value - Comma-separated keyword string
 *
 * @returns Array of trimmed keywords, or null if empty
 */
const parseKeywords = (args: { value: string }): Array<string> | null => {
  const { value } = args;

  if (!value || value.trim() === "") {
    return null;
  }

  const keywords = value
    .split(",")
    .map((k) => k.trim())
    .filter((k) => k.length > 0);

  return keywords.length > 0 ? keywords : null;
};

/**
 * Validate skillset name (allows namespaced names like org/name)
 *
 * @param args - Validation arguments
 * @param args.value - The name to validate
 *
 * @returns Undefined if valid, error message if invalid
 */
const validateNamespacedSkillsetName = (args: {
  value: string;
}): string | undefined => {
  const { value } = args;

  if (!value || value.trim() === "") {
    return "Skillset name is required";
  }

  // Allow namespaced names (org/name)
  const parts = value.split("/");

  if (parts.length > 2) {
    return "Skillset name can have at most one namespace (org/name)";
  }

  // Validate each part
  for (const part of parts) {
    const error = validateSkillsetName({ value: part });
    if (error != null) {
      return error;
    }
  }

  return undefined;
};

const CANCEL_MESSAGE = "Skillset creation cancelled.";

/**
 * Execute the interactive new skillset flow
 *
 * @returns Result on success, null on cancel
 */
export const newSkillsetFlow =
  async (): Promise<NewSkillsetFlowResult | null> => {
    const name = unwrapPrompt({
      value: await text({
        message: "Skillset name",
        placeholder: "my-skillset or org/my-skillset",
        validate: (value) =>
          validateNamespacedSkillsetName({ value: value ?? "" }),
      }),
      cancelMessage: CANCEL_MESSAGE,
    });
    if (name == null) return null;

    const description = unwrapPrompt({
      value: await text({
        message: "Description (optional)",
        placeholder: "My awesome skillset",
      }),
      cancelMessage: CANCEL_MESSAGE,
    });
    if (description == null) return null;

    const license = unwrapPrompt({
      value: await text({
        message: "License (optional)",
        placeholder: "MIT",
      }),
      cancelMessage: CANCEL_MESSAGE,
    });
    if (license == null) return null;

    const keywordsStr = unwrapPrompt({
      value: await text({
        message: "Keywords (optional, comma-separated)",
        placeholder: "testing, automation, cli",
      }),
      cancelMessage: CANCEL_MESSAGE,
    });
    if (keywordsStr == null) return null;

    const version = unwrapPrompt({
      value: await text({
        message: "Version (optional)",
        placeholder: "1.0.0",
      }),
      cancelMessage: CANCEL_MESSAGE,
    });
    if (version == null) return null;

    const repository = unwrapPrompt({
      value: await text({
        message: "Repository URL (optional)",
        placeholder: "https://github.com/user/repo",
      }),
      cancelMessage: CANCEL_MESSAGE,
    });
    if (repository == null) return null;

    return {
      name: name.trim(),
      description: description.trim() || null,
      license: license.trim() || null,
      keywords: parseKeywords({ value: keywordsStr.trim() }),
      version: version.trim() || null,
      repository: repository.trim() || null,
      statusMessage: "Skillset metadata collected",
    };
  };
