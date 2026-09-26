import { readFile, writeFile } from "node:fs/promises";
import { rollup } from "rollup";
import prettier from "prettier";

const metadata = await readFile("src/metadata.txt", "utf8");
const pkg = JSON.parse(await readFile("package.json", "utf8"));
const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
if (pkg.version !== lock.version || pkg.version !== lock.packages[""].version)
  throw new Error("Package and lockfile versions differ");
if (Object.keys(pkg.dependencies || {}).length)
  throw new Error("Userscript cannot have runtime package dependencies");
if ((metadata.match(/\{\{VERSION\}\}/g) || []).length !== 1)
  throw new Error("Metadata must contain exactly one version placeholder");
const header = metadata.replace("{{VERSION}}", pkg.version).trimEnd();
const bundle = await rollup({ input: "src/main.mjs" });
const { output } = await bundle.generate({
  format: "iife",
  name: "BangumiArkGacha",
});
await bundle.close();
if (
  output.length !== 1 ||
  output[0].type !== "chunk" ||
  output[0].imports.length
)
  throw new Error("Expected a self-contained single script");
const result =
  header +
  "\n\n// Generated from src/main.mjs and its module imports. Do not edit; run npm run build.\n" +
  (await prettier.format(output[0].code, { parser: "babel" }));
const path = "src/index.user.js";
if (process.argv.includes("--check")) {
  const shipped = await readFile(path, "utf8");
  if (shipped !== result)
    throw new Error(`${path} is stale: run npm run build`);
  console.log(
    "Userscript matches the generated single-file bundle and package version.",
  );
} else {
  await writeFile(path, result);
}
