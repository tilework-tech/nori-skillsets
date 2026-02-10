import { error, raw } from "@/cli/logger.js";

import { generateBashCompletion } from "./bashCompletion.js";
import { generateZshCompletion } from "./zshCompletion.js";

export const completionMain = (args: { shell: string }): void => {
  const { shell } = args;

  switch (shell) {
    case "bash":
      raw({ message: generateBashCompletion() });
      break;
    case "zsh":
      raw({ message: generateZshCompletion() });
      break;
    default:
      error({
        message: `Unsupported shell: ${shell}. Supported shells: bash, zsh`,
      });
      process.exit(1);
  }
};
