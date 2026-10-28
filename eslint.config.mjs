import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "api/**",
      "prisma/generated/**",
      "coverage/**",
    ],
  },
  ...tseslint.configs.recommended,
);
