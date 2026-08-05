// Flat config for ESLint 9+ (RBR-786).
//
// `npm run lint` has been declared in package.json since RBR-29 but exited 127
// for everyone: eslint was never a devDependency and no config existed. This
// makes the script real rather than decorative.
//
// Intentionally close to the recommended baseline. A first lint config that
// arrives pre-loaded with stylistic opinions produces a wall of findings on
// existing code, which gets the whole thing switched off.

import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/", "node_modules/", "data/", "graphify-out/"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    languageOptions: {
      parserOptions: { ecmaVersion: "latest", sourceType: "module" },
    },
    rules: {
      // ── Adoption baseline (RBR-786) ────────────────────────────────
      // Turning lint on for the first time surfaced 69 pre-existing
      // findings in code this issue did not author. Landing it as `error`
      // would mean either a permanently red gate or a mass edit of the
      // RBR-783 audited security stack in a repo-hygiene commit — both
      // bad. These are `warn`: fully visible, not blocking. Ratchet to
      // `error` per rule as each is burned down.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "no-useless-escape": "warn",
      "no-useless-assignment": "warn",
      "prefer-const": "warn",
    },
  },
  {
    // The guardrails and anomaly detector match C0 control characters on
    // purpose — that is the sanitisation doing its job against prompt
    // injection. Here the rule is wrong, not the code, so it is off rather
    // than downgraded.
    files: ["src/ai/**/*.ts"],
    rules: {
      "no-control-regex": "off",
      "no-misleading-character-class": "off",
    },
  },
);
