// Verbatim copy of the shared ESLint configuration used by Testkube's frontend
// projects. Keep this file identical to the upstream copy when re-syncing;
// put extension-specific changes in ../eslint.config.js instead.

import js from "@eslint/js";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import reactPlugin from "eslint-plugin-react";
import reactHooksPlugin from "eslint-plugin-react-hooks";
import importPlugin from "eslint-plugin-import";
import jsxA11yPlugin from "eslint-plugin-jsx-a11y";
import unusedImportsPlugin from "eslint-plugin-unused-imports";
import prettierConfig from "eslint-config-prettier";

export default [
  // Base ESLint recommended config
  js.configs.recommended,

  // Prettier config to disable conflicting rules
  prettierConfig,

  // Global ignores
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/cache/**",
      "**/lib/**",
      "**/.next/**",
      "**/coverage/**",
      "**/playwright-report/**",
      "**/test-results/**",
      "**/.husky/**",
      "**/webpack.*.js",
      "**/server.js",
      "**/build.js",
      "package.json",
    ],
  },

  // Main configuration for TypeScript and React files
  {
    files: ["**/*.{js,jsx,ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: {
        console: "readonly",
        process: "readonly",
        Buffer: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        module: "readonly",
        require: "readonly",
        global: "readonly",
        window: "readonly",
        document: "readonly",
        localStorage: "readonly",
        sessionStorage: "readonly",
        fetch: "readonly",
        FormData: "readonly",
        File: "readonly",
        Blob: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        AbortController: "readonly",
        ResizeObserver: "readonly",
        IntersectionObserver: "readonly",
        MutationObserver: "readonly",
        navigator: "readonly",
        location: "readonly",
        history: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        requestAnimationFrame: "readonly",
        cancelAnimationFrame: "readonly",
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
      react: reactPlugin,
      "react-hooks": reactHooksPlugin,
      import: importPlugin,
      "jsx-a11y": jsxA11yPlugin,
      "unused-imports": unusedImportsPlugin,
    },
    settings: {
      react: {
        // Explicit version avoids eslint-plugin-react calling detectReactVersion() at
        // runtime, which uses the removed context.getFilename() API in ESLint 10.
        // Update when upgrading React.
        version: "19.2",
      },
    },
    rules: {
      // Core ESLint rules
      // preserve-caught-error: new in ESLint 10 recommended — downgraded to warn because
      // existing code has high volume of catch blocks without { cause }, fixing all would be
      // a separate focused effort beyond the scope of this ESLint upgrade.
      "preserve-caught-error": "warn",
      camelcase: "off",
      "no-underscore-dangle": "off",
      "no-console": "warn",
      "no-continue": "off",
      "no-undef": "off", // TypeScript handles this
      "no-unused-vars": "off", // Use TypeScript version
      "no-nested-ternary": "off",
      "no-redeclare": "off", // Use TypeScript version
      "consistent-return": "off",
      "no-param-reassign": "off",
      "no-use-before-define": "off",
      "comma-dangle": "off",
      "no-multiple-empty-lines": "warn",
      "no-useless-escape": "off",
      "object-curly-newline": "off",
      "lines-between-class-members": "off",
      "no-restricted-syntax": "off",
      semi: "warn",
      "no-restricted-globals": "warn",
      "prefer-destructuring": "off",
      "arrow-body-style": "off",
      "arrow-parens": "off",
      "dot-notation": "off",
      "prefer-const": "off",
      "max-len": "off",
      "no-implicit-coercion": [
        "error",
        {
          boolean: true,
          number: true,
          string: true,
        },
      ],

      // TypeScript rules
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/no-redeclare": "error",
      "@typescript-eslint/no-shadow": "error",

      // React rules
      "react/jsx-uses-react": "off",
      "react/react-in-jsx-scope": "off",
      "react/no-unescaped-entities": "off",
      "react/jsx-props-no-spreading": "off",
      "react/jsx-max-props-per-line": ["warn", { maximum: 1, when: "multiline" }],
      // react/jsx-filename-extension removed: rule calls context.getFilename() which was
      // removed in ESLint 10 and eslint-plugin-react has not released a compatible version.
      // TypeScript already enforces JSX in .tsx/.jsx files at compile time.
      "react/jsx-no-target-blank": "off",
      "react/prop-types": "off",
      "react/require-default-props": "off",
      "react/self-closing-comp": "warn",
      "react/destructuring-assignment": "off",
      "react/jsx-curly-brace-presence": "warn",
      "react/no-unused-prop-types": "warn",

      // React Hooks rules
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",

      // React Compiler rules (React 19 + Compiler enforcement)
      "react-hooks/purity": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/set-state-in-render": "warn",
      "react-hooks/no-deriving-state-in-effects": "warn",

      // Import rules
      "import/no-extraneous-dependencies": "off",
      "import/prefer-default-export": "off",
      "import/no-unresolved": "off", // TypeScript handles this
      "import/extensions": "off",

      // JSX A11y rules (temporarily disabled for performance)
      "jsx-a11y/click-events-have-key-events": "off",
      "jsx-a11y/no-static-element-interactions": "off",
      "jsx-a11y/anchor-is-valid": "off",
      "jsx-a11y/no-noninteractive-element-interactions": "off",
      "jsx-a11y/alt-text": "off",
      "jsx-a11y/label-has-associated-control": [
        "warn",
        {
          controlComponents: ["Select"],
          assert: "either",
          depth: 3,
        },
      ],

      // Unused imports
      "unused-imports/no-unused-imports": "warn",

      // Spacing rules
      "spaced-comment": "warn",
      "space-in-brackets": "off",
    },
  },

  // Test files configuration
  {
    files: ["**/*.{test,spec}.{js,jsx,ts,tsx}"],
    rules: {
      "no-console": "off",
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
];
