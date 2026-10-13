// The front end's lint stage (ADR 0006, ADR 0008): the recommended rules of
// ESLint, typescript-eslint with type information, and React's hooks.
import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "src/bindings"] },
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  { languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } } },
  // This file is outside tsconfig.json, so it has no types to check against.
  { files: ["*.js"], ...tseslint.configs.disableTypeChecked },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
    plugins: { "react-hooks": reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
);
