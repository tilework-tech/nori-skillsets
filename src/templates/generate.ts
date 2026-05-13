import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export type TemplateVars = {
  agentId: string;
  agentName: string;
  skillsetId: string;
  cliBinary: string;
  authIntegrationId: string;
};

const TEMPLATE_VAR_KEYS: ReadonlyArray<keyof TemplateVars> = [
  "agentId",
  "agentName",
  "skillsetId",
  "cliBinary",
  "authIntegrationId",
];

const TEMPLATE_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "templates",
  "base-acp-agent",
);

const substitute = (args: { text: string; vars: TemplateVars }): string => {
  const { text, vars } = args;
  let result = text;
  for (const key of TEMPLATE_VAR_KEYS) {
    result = result.replaceAll(`{{${key}}}`, vars[key]);
  }
  return result;
};

const copyTemplateDir = async (args: {
  srcDir: string;
  destDir: string;
  vars: TemplateVars;
}): Promise<void> => {
  const { srcDir, destDir, vars } = args;
  await fs.mkdir(destDir, { recursive: true });

  for (const entry of await fs.readdir(srcDir, { withFileTypes: true })) {
    const srcPath = path.join(srcDir, entry.name);
    const destName = substitute({ text: entry.name, vars });
    const destPath = path.join(destDir, destName);

    if (entry.isDirectory()) {
      await copyTemplateDir({ srcDir: srcPath, destDir: destPath, vars });
    } else {
      const content = await fs.readFile(srcPath, "utf-8");
      await fs.writeFile(
        destPath,
        substitute({ text: content, vars }),
        "utf-8",
      );
    }
  }
};

export const generateFromTemplate = async (args: {
  vars: TemplateVars;
  outputDir: string;
}): Promise<void> => {
  const { vars, outputDir } = args;

  for (const key of TEMPLATE_VAR_KEYS) {
    if (vars[key] == null || vars[key].trim() === "") {
      throw new Error(
        `Required template variable '${key}' is missing or empty`,
      );
    }
  }

  try {
    await fs.access(outputDir);
    throw new Error(`Output directory already exists: ${outputDir}`);
  } catch (err) {
    if (err instanceof Error && err.message.includes("already exists")) {
      throw err;
    }
  }

  await copyTemplateDir({ srcDir: TEMPLATE_DIR, destDir: outputDir, vars });
};
