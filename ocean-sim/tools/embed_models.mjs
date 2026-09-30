// Repack dist/models/*.glb as self-contained glTF JSON (buffers and images as
// data: URIs) for hosts that do not serve .glb. Build with VITE_MODEL_EXT=json.
//   VITE_MODEL_EXT=json npx vite build --base=./ && node tools/embed_models.mjs dist/models
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";
import { readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const dir = process.argv[2] ?? "dist/models";
await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder, "meshopt.encoder": MeshoptEncoder });
for (const f of readdirSync(dir).filter((x) => x.endsWith(".glb"))) {
  const doc = await io.read(path.join(dir, f));
  const { json, resources } = await io.writeJSON(doc);
  const mime = (uri) => (uri.endsWith(".webp") ? "image/webp" : uri.endsWith(".png") ? "image/png" : uri.endsWith(".jpg") ? "image/jpeg" : "application/octet-stream");
  for (const b of json.buffers ?? []) if (b.uri && resources[b.uri]) b.uri = `data:application/octet-stream;base64,${Buffer.from(resources[b.uri]).toString("base64")}`;
  for (const im of json.images ?? []) if (im.uri && resources[im.uri]) im.uri = `data:${mime(im.uri)};base64,${Buffer.from(resources[im.uri]).toString("base64")}`;
  writeFileSync(path.join(dir, f.replace(/\.glb$/, ".json")), JSON.stringify(json));
  rmSync(path.join(dir, f));
  console.log(f, "→ json");
}
