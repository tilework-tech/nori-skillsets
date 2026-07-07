/**
 * Guard against accidentally publishing to the public registry.
 *
 * Publishing to the public registry is only allowed when the caller made the
 * target explicit — via the `--public` flag, an explicit `public/<name>`
 * namespace, or an explicit `--registry <url>`. When the public registry is
 * the target purely by default (a bare, non-namespaced name), an interactive
 * caller is asked to confirm and an automated caller is failed with guidance.
 */

import { confirmAction } from "@/cli/prompts/index.js";

/**
 * Outcome of the public-upload guard.
 * - `ok: true` — proceed with the upload.
 * - `ok: false` — do not upload. `cancelled` distinguishes a user-declined
 *   confirmation (true) from a hard error such as a contradictory target or a
 *   refused automated publish (false). `message` is the user-facing reason.
 */
export type PublicUploadGuardResult =
  | { ok: true }
  | { ok: false; cancelled: boolean; message: string };

/**
 * Decide whether an upload that would land on the public registry is allowed.
 *
 * @param args - Arguments
 * @param args.kind - Package kind, used in messaging ("skill" or "skillset")
 * @param args.packageSpec - Raw package spec as typed by the caller (used to
 *   detect an explicit `public/` namespace)
 * @param args.orgId - Parsed org namespace ("public" when none was given)
 * @param args.displayName - Package display name for messages
 * @param args.registryUrl - Explicit `--registry` value, if any
 * @param args.publicRegistry - Whether the explicit `--public` flag was passed
 * @param args.nonInteractive - Whether the command is running non-interactively
 * @param args.silent - Whether the command is running in silent mode
 *
 * @returns Whether to proceed, and if not, why
 */
export const guardPublicUpload = async (args: {
  kind: "skill" | "skillset";
  packageSpec: string;
  orgId: string;
  displayName: string;
  registryUrl?: string | null;
  publicRegistry?: boolean | null;
  nonInteractive?: boolean | null;
  silent?: boolean | null;
}): Promise<PublicUploadGuardResult> => {
  const {
    kind,
    packageSpec,
    orgId,
    displayName,
    registryUrl,
    publicRegistry,
    nonInteractive,
    silent,
  } = args;

  // Contradictory explicit targets.
  if (publicRegistry === true && registryUrl != null) {
    return {
      ok: false,
      cancelled: false,
      message: "Cannot combine --public with --registry. Choose one target.",
    };
  }
  if (publicRegistry === true && orgId !== "public") {
    return {
      ok: false,
      cancelled: false,
      message: `Cannot combine --public with the "${orgId}/" namespace. --public targets the public registry.`,
    };
  }

  const explicitlyPublic =
    publicRegistry === true ||
    registryUrl != null ||
    packageSpec.startsWith("public/");

  // Only a bare, non-namespaced name defaults to the public registry.
  const targetsPublicByDefault = orgId === "public" && !explicitlyPublic;
  if (!targetsPublicByDefault) {
    return { ok: true };
  }

  if (nonInteractive === true || silent === true) {
    return {
      ok: false,
      cancelled: false,
      message:
        `Refusing to publish "${displayName}" to the public registry (noriskillsets.dev).\n\n` +
        `Publishing to the public registry must be explicit. Re-run with one of:\n` +
        `  --public                      publish to the public registry\n` +
        `  <org>/${displayName}          publish to organization "<org>"\n` +
        `  --registry <url>              publish to a specific registry`,
    };
  }

  const confirmed = await confirmAction({
    message: `Publish ${kind} "${displayName}" to the PUBLIC registry (noriskillsets.dev)? Anyone will be able to see and install it.`,
    initialValue: false,
  });

  if (!confirmed) {
    return { ok: false, cancelled: true, message: "" };
  }

  return { ok: true };
};
