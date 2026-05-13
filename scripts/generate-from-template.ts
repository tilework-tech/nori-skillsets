#!/usr/bin/env npx tsx
/**
 * Generate a skillset from the base-acp-agent template.
 *
 * Usage:
 *   npx tsx scripts/generate-from-template.ts \
 *     --agentId goose \
 *     --agentName Goose \
 *     --skillsetId goose-skills \
 *     --cliBinary goose \
 *     --authIntegrationId goose-api-key \
 *     [--outputDir ./goose]
 *     [--upload]
 */

import { execFileSync } from "node:child_process";
import * as path from "node:path";
import { parseArgs } from "node:util";

import { generateFromTemplate } from "../src/templates/generate.js";

const { values } = parseArgs({
  options: {
    agentId: { type: "string" },
    agentName: { type: "string" },
    skillsetId: { type: "string" },
    cliBinary: { type: "string" },
    authIntegrationId: { type: "string" },
    outputDir: { type: "string" },
    upload: { type: "boolean", default: false },
  },
  strict: true,
});

const repoRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
);

const agentId = values.agentId;
const agentName = values.agentName;
const skillsetId = values.skillsetId;
const cliBinary = values.cliBinary;
const authIntegrationId = values.authIntegrationId;
const outputDir = values.outputDir
  ? path.resolve(values.outputDir)
  : path.join(repoRoot, skillsetId ?? "generated");

if (!agentId || !agentName || !skillsetId || !cliBinary || !authIntegrationId) {
  console.error(
    "Required: --agentId --agentName --skillsetId --cliBinary --authIntegrationId",
  );
  process.exit(1);
}

await generateFromTemplate({
  vars: { agentId, agentName, skillsetId, cliBinary, authIntegrationId },
  outputDir,
});

console.log(`Generated skillset at: ${outputDir}`);

if (values.upload) {
  console.log(`Uploading skillset '${skillsetId}' to registry...`);
  execFileSync("npx", ["nori-skillsets", "upload", outputDir], {
    stdio: "inherit",
    cwd: repoRoot,
  });
  console.log("Upload complete.");
}
