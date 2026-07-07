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
 * Reserved skillset names. `personal/` and `public/` are storage bucket
 * directories under profiles/, so a skillset (or org) may not use these names.
 */
export const RESERVED_SKILLSET_NAMES: ReadonlyArray<string> = [
  "personal",
  "public",
];

/**
 * Check whether a name collides with a reserved storage-bucket directory name.
 * Any path segment matching a reserved name counts (so `personal`, `public/x`,
 * and `org/personal` are all reserved), while `org/foo` is fine.
 *
 * @param args - Arguments
 * @param args.value - The name to check (bare or namespaced)
 *
 * @returns True if the name is reserved
 */
export const isReservedSkillsetName = (args: { value: string }): boolean => {
  return args.value
    .split("/")
    .some((segment) => RESERVED_SKILLSET_NAMES.includes(segment));
};

/**
 * Validate a skillset name
 *
 * Must be lowercase alphanumeric with hyphens, not starting or ending with
 * hyphen, and not a reserved storage-bucket name.
 *
 * @param args - Validation arguments
 * @param args.value - The value to validate
 *
 * @returns Undefined if valid, error message string if invalid
 */
export const validateSkillsetName = (args: {
  value: string;
}): string | undefined => {
  const slugError = validateSlugFormat({
    value: args.value,
    fieldName: "Skillset name",
  });
  if (slugError != null) {
    return slugError;
  }
  if (isReservedSkillsetName({ value: args.value })) {
    return `"${args.value}" is a reserved name and cannot be used for a skillset`;
  }
  return undefined;
};
