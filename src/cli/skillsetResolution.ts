/**
 * User-facing skillset name resolution.
 *
 * This is the single edge for turning a user-typed skillset reference (bare like
 * `foo`, or namespaced like `public/foo`, `personal/foo`, `myorg/foo`) into a
 * fully-qualified `<org>/<name>` identity, applying a configured `defaultOrg`.
 * It lives above the commands so callers reach for one clear home rather than
 * the low-level path/discovery primitives in `@/norijson/skillset.js`. Below this
 * edge the system assumes the org is present and never re-resolves.
 *
 * `defaultOrg` is always an explicit parameter here (never read from config
 * internally), so this module has no dependency on `@/cli/config.js` and stays
 * trivially unit-testable.
 */

import { resolveSkillsetDir, skillsetIdentity } from "@/norijson/skillset.js";

/**
 * Resolve a user-facing skillset name to its canonical namespaced identity
 * (e.g. `foo` -> `public/foo` or `personal/foo`). A name that resolves nowhere
 * is returned unchanged, so callers can safely canonicalize a value that may not
 * (yet) correspond to an installed skillset.
 *
 * @param args - Function arguments
 * @param args.name - The user-facing skillset name (bare or namespaced)
 *
 * @returns The namespaced identity if the skillset exists, else the name as-is
 */
export const canonicalSkillsetName = async (args: {
  name: string;
}): Promise<string> => {
  const dir = await resolveSkillsetDir({ name: args.name });
  return dir != null ? skillsetIdentity({ dir }) : args.name;
};

// Bare skillset names that have already emitted a deprecation warning this
// process, so the warning fires at most once per name.
const warnedBareNames = new Set<string>();

/**
 * Resolve a user-supplied skillset reference to its on-disk directory and its
 * canonical namespaced identity. Emits a one-time deprecation warning when a
 * bare name was used to reach a bucketed (namespaced) skillset, since bare
 * references are deprecated in favour of the namespaced identity.
 *
 * Default-org resolution is **strict**: when `nameWasProvided` and a
 * `defaultOrg` is configured, a bare name resolves to `<defaultOrg>/<name>` and
 * nothing else — it does NOT fall back to a public/personal skillset of the same
 * bare name, so a bare name is an unambiguous alias for the org (reach a
 * public/personal skillset explicitly with `public/<name>` / `personal/<name>`).
 * A bare name with no configured default org still resolves across buckets.
 *
 * @param args - Function arguments
 * @param args.name - The requested skillset name (bare, namespaced, or null)
 * @param args.activeSkillset - Fallback skillset name from config
 * @param args.defaultOrg - Org namespace a bare provided name resolves to
 * @param args.nameWasProvided - Whether `name` came from an explicit user
 *   argument; only explicit names are resolved through `defaultOrg` and warned.
 * @param args.warn - Whether to emit the deprecation warning (default true).
 *   Pass false for non-interactive/automated callers where the warning would be
 *   noise rather than a useful nudge.
 *
 * @returns The resolved directory and its namespaced identity, or null if the
 *   skillset does not exist
 */
export const resolveUserSkillsetRef = async (args: {
  name?: string | null;
  activeSkillset?: string | null;
  defaultOrg?: string | null;
  nameWasProvided?: boolean | null;
  warn?: boolean | null;
}): Promise<{ dir: string; identity: string } | null> => {
  const { defaultOrg, warn } = args;
  const name = args.name ?? args.activeSkillset ?? null;
  if (name == null) {
    return null;
  }
  const nameArgWasPassed = args.name != null;
  const nameWasProvided = args.nameWasProvided ?? nameArgWasPassed;
  // Strict: a bare provided name resolves to `<defaultOrg>/<name>` only, with no
  // fall-through to a same-named public/personal skillset.
  const target =
    nameWasProvided &&
    !name.includes("/") &&
    defaultOrg != null &&
    defaultOrg !== ""
      ? `${defaultOrg}/${name}`
      : name;

  const dir = await resolveSkillsetDir({ name: target });
  if (dir == null) {
    return null;
  }
  const identity = skillsetIdentity({ dir });
  if (
    nameWasProvided &&
    warn !== false &&
    !name.includes("/") &&
    identity.includes("/") &&
    !warnedBareNames.has(name)
  ) {
    warnedBareNames.add(name);
    process.stderr.write(
      `nori: bare skillset name "${name}" is deprecated; use "${identity}".\n`,
    );
  }
  return { dir, identity };
};

/**
 * Namespace a user-typed name for a NEWLY created skillset against a configured
 * default org: a bare name becomes `<defaultOrg>/name` so creation lands under
 * the org, while an already-namespaced name (an org, or the reserved
 * `public/`/`personal/` buckets) is returned unchanged. Unlike
 * {@link resolveUserSkillsetRef}, this does no on-disk lookup and never falls
 * back to a bare name — a creation target is chosen, not discovered, so it must
 * not resolve to an existing public/personal skillset of the same bare name.
 *
 * @param args - Function arguments
 * @param args.name - The user-typed skillset name
 * @param args.defaultOrg - Org namespace to prefer for bare names
 *
 * @returns The namespaced create name
 */
export const namespaceCreateSkillsetName = (args: {
  name: string;
  defaultOrg?: string | null;
}): string => {
  const { name, defaultOrg } = args;
  return !name.includes("/") && defaultOrg != null && defaultOrg !== ""
    ? `${defaultOrg}/${name}`
    : name;
};
