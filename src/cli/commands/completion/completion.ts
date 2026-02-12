import { log } from "@clack/prompts";

import { generateBashCompletion } from "./bashCompletion.js";
import { generateZshCompletion } from "./zshCompletion.js";

export const completionMain = (args: { shell: string }): void => {
  const { shell } = args;

  switch (shell) {
    case "bash":
      // Output raw script for shell sourcing
      process.stdout.write(generateBashCompletion());
      break;
    case "zsh":
      // Output raw script for shell sourcing
      process.stdout.write(generateZshCompletion());
      break;
    default:
      log.error(`Unsupported shell: ${shell}. Supported shells: bash, zsh`);
      process.exit(1);
  }
};
