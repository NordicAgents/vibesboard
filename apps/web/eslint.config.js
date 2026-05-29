import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import coreWebVitals from "eslint-config-next/core-web-vitals";
import prettier from "eslint-config-prettier";
import tailwind from "eslint-plugin-tailwindcss";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Extend the first coreWebVitals config (which defines react/react-hooks plugins)
// to add our rule overrides alongside its existing plugin definitions
const [coreBase, ...coreRest] = coreWebVitals;

const config = [
  {
    ...coreBase,
    rules: {
      ...coreBase.rules,
      // Unescaped quotes in JSX text are style issues, not bugs
      "react/no-unescaped-entities": "warn",
      // setState inside effects is a common valid pattern
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  ...coreRest,
  ...tailwind.configs["flat/recommended"],
  prettier,
  {
    settings: {
      tailwindcss: {
        callees: ["cn", "cva"],
        // Absolute path: the eslint-plugin-tailwindcss resolver resolves
        // `tailwindcss` relative to this config's directory. Under bun's
        // hoisted node_modules (vs pnpm's symlinked layout) a relative base
        // fails to walk up to the root install, so anchor it explicitly.
        config: join(__dirname, "tailwind.config.js"),
      },
    },
    rules: {
      "tailwindcss/no-custom-classname": "off",
    },
  },
];

export default config;
