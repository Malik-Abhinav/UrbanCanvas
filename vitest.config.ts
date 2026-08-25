import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  oxc: {
    // tsconfig sets jsx: "preserve" for Next; vitest needs real transforms.
    jsx: { runtime: "automatic" }
  },
  test: {
    exclude: [...configDefaults.exclude, "e2e/**"]
  }
});
