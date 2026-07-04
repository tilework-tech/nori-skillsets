/**
 * Post-upload local state sync
 *
 * After a successful skillset upload, the local tree must be brought in line
 * with what the registry now holds: the skillset nori.json version and
 * registryURL, extracted skill/subagent versions (in `dependencies` and in
 * each package's own nori.json), local SKILL.md/SUBAGENT.md content for
 * packages the user linked against changed remote content, and the
 * `.nori-version` provenance file.
 *
 * Only SKILL.md is overwritten for linked skills because conflict detection
 * (and the diff UI) operate at SKILL.md granularity — sibling files in the
 * skill dir are not part of the user's "discard local changes" choice. The
 * same rule applies to subagents via SUBAGENT.md.
 *
 * This module contains no prompting and no process control. Non-fatal
 * problems are returned as warnings for the caller to surface. It must never
 * import from `src/cli/`.
 */

import * as fs from "fs/promises";
import * as path from "path";

import {
  readSkillsetMetadata,
  writeSkillsetMetadata,
} from "@/norijson/nori.js";
import { writeVersionInfo } from "@/packaging/provenance.js";

import type {
  ExtractedSkillsSummary,
  ExtractedSubagentsSummary,
} from "@/api/registrar.js";
import type { NoriJson } from "@/norijson/nori.js";

/**
 * Sync local state after a successful upload.
 *
 * Updates the local nori.json version and registryURL, writes a .nori-version
 * file, updates extracted skill versions in their nori.json files and in
 * the skillset's dependencies, and overwrites local SKILL.md/SUBAGENT.md
 * files for any skills/subagents the user resolved with "Use Existing"
 * against changed remote content (so the next upload doesn't re-detect the
 * same conflict).
 *
 * @param args - The function arguments
 * @param args.skillsetDir - The local skillset directory
 * @param args.uploadedVersion - The version that was uploaded
 * @param args.registryUrl - The registry URL
 * @param args.extractedSkills - Optional extracted skills info from the response
 * @param args.linkedSkillVersions - Optional map of linked skill IDs to their remote versions
 * @param args.extractedSubagents - Optional extracted subagents info from the response
 * @param args.linkedSubagentVersions - Optional map of linked subagent IDs to their remote versions
 * @param args.linkedSkillsToReplace - Optional map of linked skill IDs to the remote SKILL.md bytes the user agreed to use; sync overwrites the local file with this content
 * @param args.linkedSubagentsToReplace - Optional map of linked subagent IDs to the remote SUBAGENT.md bytes the user agreed to use
 *
 * @returns Non-fatal warnings for the caller to surface to the user
 */
export const syncLocalStateAfterUpload = async (args: {
  skillsetDir: string;
  uploadedVersion: string;
  registryUrl: string;
  extractedSkills?: ExtractedSkillsSummary | null;
  extractedSubagents?: ExtractedSubagentsSummary | null;
  linkedSkillVersions?: Map<string, string> | null;
  linkedSubagentVersions?: Map<string, string> | null;
  linkedSkillsToReplace?: Map<string, string> | null;
  linkedSubagentsToReplace?: Map<string, string> | null;
}): Promise<{ warnings: Array<string> }> => {
  const {
    skillsetDir,
    uploadedVersion,
    registryUrl,
    extractedSkills,
    extractedSubagents,
    linkedSkillVersions,
    linkedSubagentVersions,
    linkedSkillsToReplace,
    linkedSubagentsToReplace,
  } = args;

  const warnings: Array<string> = [];

  // Update skillset nori.json version and registryURL
  let metadata: NoriJson;
  try {
    metadata = await readSkillsetMetadata({ skillsetDir });
  } catch (err) {
    if (
      err != null &&
      typeof err === "object" &&
      "code" in err &&
      err.code === "ENOENT"
    ) {
      metadata = {
        name: path.basename(skillsetDir),
        version: uploadedVersion,
        type: "skillset",
      };
    } else {
      throw err;
    }
  }

  metadata.version = uploadedVersion;
  metadata.registryURL = registryUrl;

  // Update extracted skill versions in dependencies
  const succeeded = extractedSkills?.succeeded ?? [];
  if (succeeded.length > 0) {
    if (metadata.dependencies == null) {
      metadata.dependencies = {};
    }
    if (metadata.dependencies.skills == null) {
      metadata.dependencies.skills = {};
    }

    for (const skill of succeeded) {
      metadata.dependencies.skills[skill.name] = skill.version;

      // Update individual skill nori.json
      const skillNoriJsonPath = path.join(
        skillsetDir,
        "skills",
        skill.name,
        "nori.json",
      );
      try {
        const content = await fs.readFile(skillNoriJsonPath, "utf-8");
        const skillMetadata = JSON.parse(content) as NoriJson;
        skillMetadata.version = skill.version;
        await fs.writeFile(
          skillNoriJsonPath,
          JSON.stringify(skillMetadata, null, 2),
        );
      } catch {
        // Skill nori.json may not exist (e.g., inlined skills)
      }
    }
  }

  // Update dependency versions for linked skills (kept existing remote version)
  if (linkedSkillVersions != null && linkedSkillVersions.size > 0) {
    if (metadata.dependencies == null) {
      metadata.dependencies = {};
    }
    if (metadata.dependencies.skills == null) {
      metadata.dependencies.skills = {};
    }

    for (const [skillId, version] of linkedSkillVersions) {
      metadata.dependencies.skills[skillId] = version;

      // For "Use Existing" against changed remote content, overwrite the
      // local SKILL.md with the registry's canonical version, and bump the
      // skill's individual nori.json so a follow-up upload sees a clean
      // tree. Only SKILL.md is overwritten because conflict detection (and
      // the diff UI) operate at SKILL.md granularity — sibling files in the
      // skill dir are not part of the user's "discard local changes" choice.
      const newSkillMd = linkedSkillsToReplace?.get(skillId);
      if (newSkillMd != null) {
        const skillDir = path.join(skillsetDir, "skills", skillId);
        try {
          await fs.writeFile(path.join(skillDir, "SKILL.md"), newSkillMd);
        } catch (writeErr) {
          warnings.push(
            `Could not overwrite local SKILL.md for "${skillId}": ${writeErr instanceof Error ? writeErr.message : String(writeErr)}`,
          );
        }

        const skillNoriJsonPath = path.join(skillDir, "nori.json");
        try {
          const content = await fs.readFile(skillNoriJsonPath, "utf-8");
          const skillMetadata = JSON.parse(content) as NoriJson;
          skillMetadata.version = version;
          await fs.writeFile(
            skillNoriJsonPath,
            JSON.stringify(skillMetadata, null, 2),
          );
        } catch {
          // skill nori.json may not exist (e.g. inlined skill); the
          // skillset-level dependency map above is the authoritative record.
        }
      }
    }
  }

  // Update extracted subagent versions in dependencies
  const succeededSubagents = extractedSubagents?.succeeded ?? [];
  if (succeededSubagents.length > 0) {
    if (metadata.dependencies == null) {
      metadata.dependencies = {};
    }
    if (metadata.dependencies.subagents == null) {
      metadata.dependencies.subagents = {};
    }

    for (const subagent of succeededSubagents) {
      metadata.dependencies.subagents[subagent.name] = subagent.version;

      // Update individual subagent nori.json
      const subagentNoriJsonPath = path.join(
        skillsetDir,
        "subagents",
        subagent.name,
        "nori.json",
      );
      try {
        const content = await fs.readFile(subagentNoriJsonPath, "utf-8");
        const subagentMetadata = JSON.parse(content) as NoriJson;
        subagentMetadata.version = subagent.version;
        await fs.writeFile(
          subagentNoriJsonPath,
          JSON.stringify(subagentMetadata, null, 2),
        );
      } catch {
        // Subagent nori.json may not exist (e.g., inlined subagents)
      }
    }
  }

  // Update dependency versions for linked subagents
  if (linkedSubagentVersions != null && linkedSubagentVersions.size > 0) {
    if (metadata.dependencies == null) {
      metadata.dependencies = {};
    }
    if (metadata.dependencies.subagents == null) {
      metadata.dependencies.subagents = {};
    }

    for (const [subagentId, version] of linkedSubagentVersions) {
      metadata.dependencies.subagents[subagentId] = version;

      // Mirror of the linked-skill replacement: overwrite local SUBAGENT.md
      // and the subagent's nori.json when the user picked "Use Existing"
      // against changed remote content. Subagents have two possible
      // on-disk layouts: directory (subagents/<id>/SUBAGENT.md) or flat
      // (subagents/<id>.md). Preserve whichever the user has locally.
      const newSubagentMd = linkedSubagentsToReplace?.get(subagentId);
      if (newSubagentMd != null) {
        const subagentDir = path.join(skillsetDir, "subagents", subagentId);
        const subagentMdPath = path.join(subagentDir, "SUBAGENT.md");
        const flatSubagentMdPath = path.join(
          skillsetDir,
          "subagents",
          `${subagentId}.md`,
        );

        let targetPath: string | null = null;
        try {
          await fs.access(subagentMdPath);
          targetPath = subagentMdPath;
        } catch {
          try {
            await fs.access(flatSubagentMdPath);
            targetPath = flatSubagentMdPath;
          } catch {
            // Neither layout exists locally. The conflict surface implies
            // the subagent was part of the upload payload, so a missing
            // local file is surprising — surface it instead of silently
            // swallowing. This path is most likely hit if the skillset was
            // restructured mid-upload (e.g. flat → directory) and a stale
            // conflict slipped through.
            warnings.push(
              `Could not locate local SUBAGENT.md for "${subagentId}" (tried ${subagentMdPath} and ${flatSubagentMdPath}); skipping overwrite.`,
            );
          }
        }

        if (targetPath != null) {
          try {
            await fs.writeFile(targetPath, newSubagentMd);
          } catch (writeErr) {
            warnings.push(
              `Could not overwrite local SUBAGENT.md for "${subagentId}": ${writeErr instanceof Error ? writeErr.message : String(writeErr)}`,
            );
          }
        }

        const subagentNoriJsonPath = path.join(subagentDir, "nori.json");
        try {
          const content = await fs.readFile(subagentNoriJsonPath, "utf-8");
          const subagentMetadata = JSON.parse(content) as NoriJson;
          subagentMetadata.version = version;
          await fs.writeFile(
            subagentNoriJsonPath,
            JSON.stringify(subagentMetadata, null, 2),
          );
        } catch {
          // subagent nori.json may not exist (e.g. flat or inlined subagents)
        }
      }
    }
  }

  await writeSkillsetMetadata({ skillsetDir, metadata });

  await writeVersionInfo({
    dir: skillsetDir,
    versionInfo: { version: uploadedVersion, registryUrl },
  });

  return { warnings };
};
