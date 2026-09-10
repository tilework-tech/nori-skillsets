/**
 * Bulk `seed` command.
 *
 * Replaces an external caller's N sequential `nori-skillsets` subprocess
 * invocations (download + fork + upload per skillset) with a single in-process
 * run that seeds a whole manifest into an org's private registry.
 *
 * For each manifest entry it downloads the source skillset (its full skill /
 * subagent dependency closure comes with it), rescopes (forks) it to
 * `<orgId>/<name>`, and uploads it. Sources are downloaded once each (deduped by
 * source name); the registrar's content-hash dedup handles shared dependencies.
 * Per-entry failures are captured and never abort the batch.
 *
 * The command prints normal human framing and emits exactly one machine-readable
 * result line to stdout:
 *
 *   NORI_SEED_RESULT_JSON=<compact-json>
 *
 * so a parent process can capture the outcome off stdout.
 */

import { log } from "@clack/prompts";

import { forkSkillsetMain } from "@/cli/commands/fork-skillset/forkSkillset.js";
import { registryDownloadMain } from "@/cli/commands/registry-download/registryDownload.js";
import { registryUploadMain } from "@/cli/commands/registry-upload/registryUpload.js";

import type { CommandStatus } from "@/cli/commands/commandStatus.js";

/** A single skillset to seed: download `source`, publish it as `<org>/<name>`. */
export type SeedManifestEntry = {
  source: string;
  name: string;
};

type SeedPhase = "download" | "rescope" | "upload";

type SeedSucceeded = {
  source: string;
  target: string;
  version: string | null;
};

type SeedFailed = {
  source: string;
  target: string;
  phase: SeedPhase;
  dependency: string | null;
  error: string;
};

type SeedPhaseTiming = {
  target: string;
  download_ms: number;
  upload_ms: number;
};

type SeedResult = {
  succeeded: Array<SeedSucceeded>;
  failed: Array<SeedFailed>;
  timings: {
    total_ms: number;
    phases: Array<SeedPhaseTiming>;
  };
};

const SENTINEL_PREFIX = "NORI_SEED_RESULT_JSON=";

const errorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

/**
 * Extract the uploaded version from an upload result message.
 *
 * The upload primitive reports success as a human message (e.g.
 * `Uploaded myorg/name@1.2.3`, ANSI-styled). There is no structured version on
 * the return, so parse the `@<version>` token, tolerating styling codes. Returns
 * null when no version token is present.
 *
 * @param args - Arguments
 * @param args.message - The upload result message
 *
 * @returns The version string, or null when none can be found
 */
const parseUploadedVersion = (args: { message: string }): string | null => {
  const { message } = args;
  // eslint-disable-next-line no-control-regex
  const stripped = message.replace(/\u001b\[[0-9;]*m/g, "");
  const match = stripped.match(/@(\d+\.\d+\.\d+[^\s"']*)/);
  return match != null ? match[1] : null;
};

type SourceDownload = {
  ok: boolean;
  error: string | null;
  ms: number;
};

/**
 * Seed a manifest of skillsets into an org registry.
 *
 * @param args - Arguments
 * @param args.orgId - Target organization id; each entry publishes to `<orgId>/<name>`
 * @param args.manifest - Skillsets to seed
 * @param args.installDir - Optional explicit install directory
 *
 * @returns Command status. `success` is true whenever the batch ran to
 *   completion and emitted a result (even if some entries failed); it is false
 *   only for a pre-run validation error, before any sentinel is emitted.
 */
export const seedMain = async (args: {
  orgId: string;
  manifest: Array<SeedManifestEntry>;
  installDir?: string | null;
}): Promise<CommandStatus> => {
  const { orgId, manifest, installDir } = args;

  if (orgId == null || orgId.trim() === "") {
    log.error("Seed requires a target --org.");
    return { success: false, cancelled: false, message: "Missing --org" };
  }

  if (!Array.isArray(manifest)) {
    log.error(
      "Seed manifest must be a JSON array of { source, name } entries.",
    );
    return { success: false, cancelled: false, message: "Invalid manifest" };
  }

  for (const entry of manifest) {
    if (
      entry == null ||
      typeof entry.source !== "string" ||
      typeof entry.name !== "string" ||
      entry.source.trim() === "" ||
      entry.name.trim() === ""
    ) {
      log.error(
        'Each manifest entry must have a non-empty "source" and "name".',
      );
      return { success: false, cancelled: false, message: "Invalid manifest" };
    }
  }

  const started = Date.now();
  const succeeded: Array<SeedSucceeded> = [];
  const failed: Array<SeedFailed> = [];
  const phases: Array<SeedPhaseTiming> = [];

  // Download each unique source once. Its full dependency closure comes with it,
  // and the registrar dedups shared deps by content hash on upload.
  const downloadBySource = new Map<string, SourceDownload>();
  const uniqueSources = [...new Set(manifest.map((entry) => entry.source))];
  for (const source of uniqueSources) {
    const startedAt = Date.now();
    try {
      const result = await registryDownloadMain({
        packageSpec: source,
        installDir,
        nonInteractive: true,
      });
      downloadBySource.set(source, {
        ok: result.success,
        error: result.success ? null : result.message,
        ms: Date.now() - startedAt,
      });
    } catch (err) {
      downloadBySource.set(source, {
        ok: false,
        error: errorMessage(err),
        ms: Date.now() - startedAt,
      });
    }
  }

  for (const entry of manifest) {
    const target = `${orgId}/${entry.name}`;
    const download = downloadBySource.get(entry.source)!;
    let uploadMs = 0;

    if (!download.ok) {
      failed.push({
        source: entry.source,
        target,
        phase: "download",
        dependency: null,
        error: download.error ?? "Download failed",
      });
      phases.push({ target, download_ms: download.ms, upload_ms: uploadMs });
      continue;
    }

    // Rescope the downloaded source to the org-scoped target.
    let rescoped = false;
    try {
      const forkResult = await forkSkillsetMain({
        baseSkillset: entry.source,
        newSkillset: target,
      });
      if (forkResult.success) {
        rescoped = true;
      } else {
        failed.push({
          source: entry.source,
          target,
          phase: "rescope",
          dependency: null,
          error: forkResult.message,
        });
      }
    } catch (err) {
      failed.push({
        source: entry.source,
        target,
        phase: "rescope",
        dependency: null,
        error: errorMessage(err),
      });
    }

    if (!rescoped) {
      phases.push({ target, download_ms: download.ms, upload_ms: uploadMs });
      continue;
    }

    // Upload via scope-derived routing (no explicit registry URL). Use
    // conflict resolution rather than the silent path, which skips it.
    const uploadStartedAt = Date.now();
    try {
      const uploadResult = await registryUploadMain({
        profileSpec: target,
        installDir,
        nonInteractive: true,
        resolve: "updateVersion",
      });
      uploadMs = Date.now() - uploadStartedAt;
      if (uploadResult.success) {
        succeeded.push({
          source: entry.source,
          target,
          version: parseUploadedVersion({ message: uploadResult.message }),
        });
      } else {
        failed.push({
          source: entry.source,
          target,
          phase: "upload",
          dependency: null,
          error: uploadResult.message,
        });
      }
    } catch (err) {
      uploadMs = Date.now() - uploadStartedAt;
      failed.push({
        source: entry.source,
        target,
        phase: "upload",
        dependency: null,
        error: errorMessage(err),
      });
    }

    phases.push({ target, download_ms: download.ms, upload_ms: uploadMs });
  }

  const result: SeedResult = {
    succeeded,
    failed,
    timings: { total_ms: Date.now() - started, phases },
  };

  // Single machine-readable line on stdout for the parent process to capture.
  console.log(`${SENTINEL_PREFIX}${JSON.stringify(result)}`);

  return {
    success: true,
    cancelled: false,
    message: `Seeded ${succeeded.length}/${manifest.length} skillset(s) into "${orgId}"`,
  };
};
