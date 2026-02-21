/**
 * Prompts validation functions
 *
 * Validators return undefined for valid input, or an error message string
 * for invalid input, matching clack/prompts validation callback signature.
 */

/**
 * Pattern for valid slugs (lowercase alphanumeric with hyphens)
 * Does not allow starting/ending with hyphen or consecutive hyphens
 */
const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Validate a slug format (lowercase alphanumeric with hyphens)
 *
 * @param args - Validation arguments
 * @param args.value - The value to validate
 * @param args.fieldName - Field name for error messages
 *
 * @returns Undefined if valid, error message string if invalid
 */
const validateSlugFormat = (args: {
  value: string;
  fieldName: string;
}): string | undefined => {
  const { value, fieldName } = args;

  if (!value || value.trim() === "") {
    return `${fieldName} is required`;
  }

  if (!SLUG_PATTERN.test(value)) {
    return "Use lowercase letters, numbers, and hyphens only";
  }

  return undefined;
};

/**
 * Validate a skillset name
 *
 * Must be lowercase alphanumeric with hyphens, not starting or ending with hyphen
 *
 * @param args - Validation arguments
 * @param args.value - The value to validate
 *
 * @returns Undefined if valid, error message string if invalid
 */
export const validateSkillsetName = (args: {
  value: string;
}): string | undefined => {
  return validateSlugFormat({ value: args.value, fieldName: "Skillset name" });
};
