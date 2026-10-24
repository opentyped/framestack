import framestack from "@opentyped/framestack-eslint";
import { defineConfig } from "eslint/config";

export default defineConfig([
  ...framestack,
  // Your own rules and overrides go here.
]);
