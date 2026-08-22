/** @type {import('prettier').Config} */
module.exports = {
  endOfLine: 'lf',
  semi: false,
  useTabs: false,
  singleQuote: true,
  arrowParens: 'avoid',
  tabWidth: 2,
  trailingComma: 'none'
  // NOTE: the `importOrder*` options that used to live here belonged to
  // @trivago/prettier-plugin-sort-imports, which is not a dependency of this
  // repo. Prettier 3 requires plugins to be listed explicitly in `plugins`, so
  // every one of those keys was silently ignored and printed an "Ignored
  // unknown option" warning on each run. Import order is not enforced today.
  // To bring it back, add the plugin to devDependencies, register it under
  // `plugins`, and restore the option block in the same commit.
}
