// Repack every .bin under a directory as {"b64": "..."} .json for hosts that do not
// serve .bin files. Build with VITE_DATA_EXT=json.
//   node tools/embed_data.mjs dist/data
import { readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

function walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (f.endsWith(".bin")) {
      writeFileSync(p.replace(/\.bin$/, ".json"), JSON.stringify({ b64: readFileSync(p).toString("base64") }));
      rmSync(p);
    }
  }
}
walk(process.argv[2] ?? "dist/data");
