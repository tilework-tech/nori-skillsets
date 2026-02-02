const configs = require("./configs/index.cjs");

module.exports = [
  {
    ignores: [
      "dist/",
      "node_modules/",
      ".git/",
      "**/build/",
      "**/.worktrees/",
      ".nori/",
      ".nori-bak/",
    ],
  },
  ...configs.eslint,

  // The configs repository needs `require` because it's defining node files
  // which configure eslint.
  {
    files: ["configs/**/*.cjs"],
    rules: {
      "@typescript-eslint/no-var-requires": "off",
    },
  },

  // cjs files require `require`.
  {
    files: ["**/*.cjs"],
    rules: {
      "@typescript-eslint/no-var-requires": "off",
    },
  },
];
