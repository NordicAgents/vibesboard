import coreWebVitals from "eslint-config-next/core-web-vitals";
import prettier from "eslint-config-prettier";
import tailwind from "eslint-plugin-tailwindcss";

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
        config: "tailwind.config.js",
      },
    },
    rules: {
      "tailwindcss/no-custom-classname": "off",
    },
  },
];

export default config;
