/**
 * New skillset flow module
 *
 * Provides the complete interactive new skillset creation experience using @clack/prompts.
 * This flow handles:
 * - Collecting skillset metadata (name, description, license, keywords, version, repository)
 * - Validating skillset name
 * - Parsing keywords from comma-separated string to array
 * - Intro/outro framing
 */

import { intro, outro, group, text, isCancel, cancel } from "@clack/prompts";

import { validateProfileName } from "@/cli/prompts/validators.js";

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
const validateSkillsetName = (args: { value: string }): string | undefined => {
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
    const error = validateProfileName({ value: part });
    if (error != null) {
      return error;
    }
  }

  return undefined;
};

/**
 * Execute the interactive new skillset flow
 *
 * @returns Result on success, null on cancel
 */
export const newSkillsetFlow =
  async (): Promise<NewSkillsetFlowResult | null> => {
    intro("Create New Skillset");

    const result = await group(
      {
        name: () =>
          text({
            message: "Skillset name",
            placeholder: "my-skillset or org/my-skillset",
            validate: (value) => validateSkillsetName({ value: value ?? "" }),
          }),
        description: () =>
          text({
            message: "Description (optional)",
            placeholder: "My awesome skillset",
          }),
        license: () =>
          text({
            message: "License (optional)",
            placeholder: "MIT",
          }),
        keywords: () =>
          text({
            message: "Keywords (optional, comma-separated)",
            placeholder: "testing, automation, cli",
          }),
        version: () =>
          text({
            message: "Version (optional)",
            placeholder: "1.0.0",
          }),
        repository: () =>
          text({
            message: "Repository URL (optional)",
            placeholder: "https://github.com/user/repo",
          }),
      },
      {
        onCancel: () => {
          // cancel() is called automatically by group
        },
      },
    );

    if (isCancel(result)) {
      cancel("Skillset creation cancelled.");
      return null;
    }

    // Transform the result
    const name = (result.name as string).trim();
    const description = (result.description as string)?.trim() || null;
    const license = (result.license as string)?.trim() || null;
    const keywordsStr = (result.keywords as string)?.trim() || "";
    const keywords = parseKeywords({ value: keywordsStr });
    const version = (result.version as string)?.trim() || null;
    const repository = (result.repository as string)?.trim() || null;

    outro("Skillset metadata collected");

    return {
      name,
      description,
      license,
      keywords,
      version,
      repository,
    };
  };
