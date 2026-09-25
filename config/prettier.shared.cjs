// Verbatim copy of the shared Prettier configuration used by Testkube's
// frontend projects. Keep identical to the upstream copy when re-syncing.

module.exports = {
  plugins: ["@trivago/prettier-plugin-sort-imports"],
  importOrder: ["^react", "^(antd|@ant-design)", "^@reduxjs", "<THIRD_PARTY_MODULES>", "^\\.\\.(\\/)?", "^\\.\\/", "^.$"],

  importOrderSeparation: true,
  importOrderSortSpecifiers: true,

  singleQuote: true,
  arrowParens: "avoid",
  semi: true,
  printWidth: 120,
  trailingComma: "es5",
  bracketSpacing: false,
  bracketSameLine: false,
  proseWrap: "always",
  quoteProps: "as-needed",
  tabWidth: 2,
  useTabs: false,
};
