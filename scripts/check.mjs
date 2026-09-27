// Read-only delivery gate; run from any working directory.
import { readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));

async function modules(directory) {
  const entries = await readdir(path.join(root, directory), {
    withFileTypes: true,
  });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const name = `${directory}/${entry.name}`;
      return entry.isDirectory()
        ? modules(name)
        : entry.name.endsWith(".mjs")
          ? [name]
          : [];
    }),
  );
  return files.flat().sort();
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${command} ${args.join(" ")} failed (${result.status})`);
}

const files = [
  "src/index.user.js",
  ...(await modules("src")),
  ...(await modules("scripts")),
  ...(await modules("tests")),
];
run(path.join(root, "node_modules/.bin/prettier"), ["--check", ...files]);
for (const file of files) run(process.execPath, ["--check", file]);
run(process.execPath, [
  "--test",
  ...files.filter((file) => file.endsWith(".test.mjs")),
]);
run(process.execPath, ["scripts/build.mjs", "--check"]);
