/**
 * Skillset upload pipeline
 *
 * Orchestrates the packaging half of a skillset upload: candidate nori.json
 * creation for inline/extract decisions, flat-subagent inline-vs-extract
 * partitioning (persisting inline choices, restructuring extracted flat
 * files into directories), tarball creation, inline-list merging, the
 * registrar upload call, and mapping collision errors into the
 * `UploadResult` union.
 *
 * This module contains no prompting, no CLI parsing, and no process control.
 * It must never import from `src/cli/`.
 */

import * as fs from "fs/promises";
import * as path from "path";

import { registrarApi } from "@/api/registrar.js";
import {
  readSkillsetMetadata,
  writeSkillsetMetadata,
} from "@/norijson/nori.js";
import { createArchive } from "@/packaging/archive.js";
import { parseSubagentFrontmatter } from "@/packaging/subagentDiscovery.js";
import {
  isSkillCollisionError,
  isSubagentCollisionError,
} from "@/utils/fetch.js";

import type {
  SkillResolutionStrategy,
  SubagentResolutionStrategy,
  UploadSkillsetResponse,
} from "@/api/registrar.js";
import type { UploadResult } from "@/core/uploadPolicy.js";
import type { NoriJson } from "@/norijson/nori.js";

/**
 * Create nori.json files for inline/extract skill candidates after resolution.
 *
 * @param args - The function arguments
 * @param args.skillsetDir - The skillset directory
 * @param args.inlineCandidates - All skill IDs that were candidates (no nori.json)
 * @param args.inlineSkillIds - Skill IDs that were chosen to be kept inline
 */
const createCandidateNoriJsonFiles = async (args: {
  skillsetDir: string;
  inlineCandidates: Array<string>;
  inlineSkillIds: Array<string>;
}): Promise<void> => {
  const { skillsetDir, inlineCandidates, inlineSkillIds } = args;
  const inlineSet = new Set(inlineSkillIds);

  for (const candidate of inlineCandidates) {
    const skillDir = path.join(skillsetDir, "skills", candidate);
    const noriJsonPath = path.join(skillDir, "nori.json");
    const type = inlineSet.has(candidate) ? "inlined-skill" : "skill";
    const metadata: NoriJson = {
      name: candidate,
      version: "1.0.0",
      type,
    };
    await fs.writeFile(noriJsonPath, JSON.stringify(metadata, null, 2));
  }
};

/**
 * Create nori.json files for inline/extract subagent candidates after resolution.
 *
 * @param args - The function arguments
 * @param args.skillsetDir - The skillset directory
 * @param args.inlineCandidates - All subagent IDs that were candidates (no nori.json)
 * @param args.inlineSubagentIds - Subagent IDs that were chosen to be kept inline
 */
const createCandidateSubagentNoriJsonFiles = async (args: {
  skillsetDir: string;
  inlineCandidates: Array<string>;
  inlineSubagentIds: Array<string>;
}): Promise<void> => {
  const { skillsetDir, inlineCandidates, inlineSubagentIds } = args;
  const inlineSet = new Set(inlineSubagentIds);

  for (const candidate of inlineCandidates) {
    const subagentDir = path.join(skillsetDir, "subagents", candidate);
    const noriJsonPath = path.join(subagentDir, "nori.json");
    const type = inlineSet.has(candidate) ? "inlined-subagent" : "subagent";
    const metadata: NoriJson = {
      name: candidate,
      version: "1.0.0",
      type,
    };
    await fs.writeFile(noriJsonPath, JSON.stringify(metadata, null, 2));
  }
};

/**
 * Persist "keep inline" decisions for flat .md subagents by adding them
 * to the skillset's nori.json subagents array. Parses frontmatter for
 * name and description.
 *
 * @param args - The function arguments
 * @param args.skillsetDir - The skillset directory
 * @param args.flatSubagentIds - IDs of flat subagents chosen to be kept inline
 */
export const persistFlatSubagentInlineChoices = async (args: {
  skillsetDir: string;
  flatSubagentIds: Array<string>;
}): Promise<void> => {
  const { skillsetDir, flatSubagentIds } = args;
  if (flatSubagentIds.length === 0) return;

  const subagentsDir = path.join(skillsetDir, "subagents");
  let metadata: NoriJson;
  try {
    metadata = await readSkillsetMetadata({ skillsetDir });
  } catch {
    return;
  }

  const subagents = metadata.subagents ?? [];
  const existingIds = new Set(subagents.map((s) => s.id));

  for (const id of flatSubagentIds) {
    if (existingIds.has(id)) continue;

    const filePath = path.join(subagentsDir, `${id}.md`);
    let name = id;
    let description = "";

    try {
      const content = await fs.readFile(filePath, "utf-8");
      const parsed = parseSubagentFrontmatter({ content });
      if (parsed != null) {
        name = parsed.name;
        description = parsed.description;
      }
    } catch {
      // File read failed — use defaults
    }

    subagents.push({ id, name, description });
  }

  metadata.subagents = subagents;
  await writeSkillsetMetadata({ skillsetDir, metadata });
};

/**
 * Restructure flat .md subagent files into directory-based format for extraction.
 * Moves foo.md → foo/SUBAGENT.md and creates foo/nori.json.
 *
 * @param args - The function arguments
 * @param args.skillsetDir - The skillset directory
 * @param args.flatSubagentIds - IDs of flat subagents chosen to be extracted
 */
const restructureFlatSubagentsToDirectories = async (args: {
  skillsetDir: string;
  flatSubagentIds: Array<string>;
}): Promise<void> => {
  const { skillsetDir, flatSubagentIds } = args;
  if (flatSubagentIds.length === 0) return;

  const subagentsDir = path.join(skillsetDir, "subagents");

  for (const id of flatSubagentIds) {
    const flatFilePath = path.join(subagentsDir, `${id}.md`);

    // Skip if already restructured on a previous call (idempotent)
    try {
      await fs.access(flatFilePath);
    } catch {
      continue;
    }

    const dirPath = path.join(subagentsDir, id);
    const subagentMdPath = path.join(dirPath, "SUBAGENT.md");
    const noriJsonPath = path.join(dirPath, "nori.json");

    const content = await fs.readFile(flatFilePath, "utf-8");
    const parsed = parseSubagentFrontmatter({ content });
    const name = parsed?.name ?? id;

    await fs.mkdir(dirPath, { recursive: true });
    await fs.writeFile(subagentMdPath, content);
    await fs.rm(flatFilePath);

    const noriJson: NoriJson = {
      name,
      version: "1.0.0",
      type: "subagent",
    };
    await fs.writeFile(noriJsonPath, JSON.stringify(noriJson, null, 2));
  }
};

/**
 * Perform a skillset upload: prepare candidate nori.json files, partition
 * flat subagents into inline vs extract, create the tarball, merge existing
 * and newly-resolved inline lists, and call the registrar upload API.
 * Collision errors are mapped into the `UploadResult` union instead of
 * being thrown.
 *
 * @param args - The function arguments
 * @param args.skillsetDir - The local skillset directory to package
 * @param args.packageName - The skillset package name on the registry
 * @param args.uploadVersion - The version to upload
 * @param args.registryUrl - The target registry URL
 * @param args.authToken - Auth token for the registry
 * @param args.description - Optional description for the skillset version
 * @param args.resolutionStrategy - Optional per-skill conflict resolutions
 * @param args.subagentResolutionStrategy - Optional per-subagent conflict resolutions
 * @param args.inlineSkills - Skill IDs newly resolved to be kept inline
 * @param args.inlineSubagents - Subagent IDs newly resolved to be kept inline
 * @param args.inlineCandidates - Skill IDs that were candidates (no nori.json)
 * @param args.subagentInlineCandidates - Directory-based subagent IDs that were candidates (no nori.json)
 * @param args.flatSubagentCandidates - Flat .md subagent IDs awaiting an inline/extract decision
 * @param args.existingInlineSkills - Skill IDs already marked inlined from a previous upload
 * @param args.existingInlineSubagents - Subagent IDs already marked inlined from a previous upload
 * @param args.existingFlatInlineSubagents - Flat subagent IDs already declared inline in nori.json
 *
 * @returns The upload result (success, conflicts, or error)
 */
export const performSkillsetUpload = async (args: {
  skillsetDir: string;
  packageName: string;
  uploadVersion: string;
  registryUrl: string;
  authToken: string;
  description?: string | null;
  resolutionStrategy?: SkillResolutionStrategy | null;
  subagentResolutionStrategy?: SubagentResolutionStrategy | null;
  inlineSkills?: Array<string> | null;
  inlineSubagents?: Array<string> | null;
  inlineCandidates: Array<string>;
  subagentInlineCandidates: Array<string>;
  flatSubagentCandidates: Array<string>;
  existingInlineSkills: Array<string>;
  existingInlineSubagents: Array<string>;
  existingFlatInlineSubagents: Array<string>;
}): Promise<UploadResult> => {
  const {
    skillsetDir,
    packageName,
    uploadVersion,
    registryUrl,
    authToken,
    description,
    resolutionStrategy,
    subagentResolutionStrategy,
    inlineSkills,
    inlineSubagents,
    inlineCandidates,
    subagentInlineCandidates,
    flatSubagentCandidates,
    existingInlineSkills,
    existingInlineSubagents,
    existingFlatInlineSubagents,
  } = args;

  try {
    // Create nori.json for inline/extract candidates before tarball creation
    if (inlineCandidates.length > 0) {
      await createCandidateNoriJsonFiles({
        skillsetDir,
        inlineCandidates,
        inlineSkillIds: inlineSkills ?? [],
      });
    }

    // Create nori.json for directory-based subagent inline/extract candidates
    if (subagentInlineCandidates.length > 0) {
      await createCandidateSubagentNoriJsonFiles({
        skillsetDir,
        inlineCandidates: subagentInlineCandidates,
        inlineSubagentIds: inlineSubagents ?? [],
      });
    }

    // Handle flat subagent resolution: partition into inline vs extract
    const resolvedInlineSubagentIds = new Set(inlineSubagents ?? []);
    const flatInlineIds = flatSubagentCandidates.filter((id) =>
      resolvedInlineSubagentIds.has(id),
    );
    const flatExtractIds = flatSubagentCandidates.filter(
      (id) => !resolvedInlineSubagentIds.has(id),
    );

    // Persist "keep inline" decisions for flat subagents
    if (flatInlineIds.length > 0) {
      await persistFlatSubagentInlineChoices({
        skillsetDir,
        flatSubagentIds: flatInlineIds,
      });
    }

    // Restructure "extract" flat subagents into directory format
    if (flatExtractIds.length > 0) {
      await restructureFlatSubagentsToDirectories({
        skillsetDir,
        flatSubagentIds: flatExtractIds,
      });
    }

    const tarballBuffer = await createArchive({ sourceDir: skillsetDir });
    const archiveData = new ArrayBuffer(tarballBuffer.byteLength);
    new Uint8Array(archiveData).set(tarballBuffer);

    // Merge existing inlined skills with newly-resolved inline candidates
    const allInlineSkills = [...existingInlineSkills, ...(inlineSkills ?? [])];

    // Merge existing inlined subagents with newly-resolved inline candidates
    // Include both directory-based and flat inline subagents
    const allInlineSubagents = [
      ...existingInlineSubagents,
      ...existingFlatInlineSubagents,
      ...(inlineSubagents ?? []),
    ];

    const result: UploadSkillsetResponse = await registrarApi.uploadSkillset({
      packageName,
      version: uploadVersion,
      archiveData,
      authToken,
      registryUrl,
      description: description ?? undefined,
      resolutionStrategy: resolutionStrategy ?? undefined,
      subagentResolutionStrategy: subagentResolutionStrategy ?? undefined,
      inlineSkills: allInlineSkills.length > 0 ? allInlineSkills : undefined,
      inlineSubagents:
        allInlineSubagents.length > 0 ? allInlineSubagents : undefined,
    });

    return {
      success: true,
      version: result.version,
      extractedSkills: result.extractedSkills,
      extractedSubagents: result.extractedSubagents,
    };
  } catch (err) {
    if (isSkillCollisionError(err)) {
      return {
        success: false,
        conflicts: err.conflicts,
      };
    }

    if (isSubagentCollisionError(err)) {
      return {
        success: false,
        subagentConflicts: err.conflicts,
      };
    }

    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
};
