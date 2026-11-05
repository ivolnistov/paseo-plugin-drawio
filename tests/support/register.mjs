// Lets node:test import the plugin's TypeScript sources as Paseo's bundler would:
// extensionless relative imports resolve to .ts, `.txt` assets load as text, and
// react-native resolves to a small stub because its package is not loadable by Node.
import { registerHooks } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

// TSX needs a JSX transform that Node lacks; the declared typescript devDependency provides it.
let ts = null;
const loadTypescript = () => (ts ??= createRequire(import.meta.url)("typescript"));
const clientStub = pathToFileURL(fileURLToPath(new URL("./paseo-client-stub.mjs", import.meta.url))).href;

const stub = pathToFileURL(fileURLToPath(new URL("./react-native-stub.mjs", import.meta.url))).href;

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "react-native") return { url: stub, shortCircuit: true };
    if (specifier === "@getpaseo/plugin/client" || specifier === "@getpaseo/plugin/client/ui") return { url: clientStub, shortCircuit: true };
    if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:")) {
      const base = new URL(specifier, context.parentURL);
      const file = fileURLToPath(base);
      if (!existsSync(file) || file.endsWith("/")) {
        for (const ext of [".ts", ".tsx"]) {
          if (existsSync(file + ext)) return { url: base.href + ext, shortCircuit: true };
        }
      }
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.endsWith(".txt")) {
      const text = readFileSync(fileURLToPath(url), "utf8");
      return { format: "module", source: `export default ${JSON.stringify(text)};`, shortCircuit: true };
    }
    if (url.endsWith(".tsx")) {
      const source = readFileSync(fileURLToPath(url), "utf8");
      const t = loadTypescript();
      const { outputText } = t.transpileModule(source, {
        fileName: fileURLToPath(url),
        compilerOptions: { module: t.ModuleKind.ESNext, target: t.ScriptTarget.ES2022, jsx: t.JsxEmit.ReactJSX, verbatimModuleSyntax: false },
      });
      return { format: "module", source: outputText, shortCircuit: true };
    }
    return next(url, context);
  },
});
