import { createRequire, registerHooks } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const typescriptCompatUrl = pathToFileURL(
  require.resolve("typescript-eslint-compiler"),
).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      specifier === "typescript" &&
      (context.parentURL?.includes("@typescript-eslint") ||
        context.parentURL?.includes("/node_modules/typescript-eslint/") ||
        context.parentURL?.includes("ts-api-utils"))
    ) {
      return { shortCircuit: true, url: typescriptCompatUrl };
    }
    return nextResolve(specifier, context);
  },
});
