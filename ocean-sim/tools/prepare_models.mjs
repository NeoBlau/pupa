// Optimise third-party sea-life models for the browser.
//
//   node tools/prepare_models.mjs <assets-root>
//
// <assets-root> holds shallow clones of the source repositories:
//   babylon/                     https://github.com/BabylonJS/Assets            (CC-BY 4.0)
//   pmndrs_examples/             https://github.com/pmndrs/examples             (turtle: CC-BY-NC 4.0)
//   gkjohnson_3d-demo-data/      https://github.com/gkjohnson/3d-demo-data      (threedscans.com, free)
//   KhronosGroup_glTF-Sample-Assets/ https://github.com/KhronosGroup/glTF-Sample-Assets (CC0)
//   pmndrs_market-assets/        https://github.com/pmndrs/market-assets        (Kenney, CC0)
//
// Steps per model: spec/gloss → metal/rough, prune/dedup, textures resized and
// re-encoded as WebP, scans decimated with meshoptimizer, geometry quantised
// and meshopt-compressed. Output: public/models/*.glb + credits.json.
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, meshopt, metalRough, normals, prune, quantize, resample, simplify, textureCompress, weld } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from "meshoptimizer";
import sharp from "sharp";
import draco3d from "draco3dgltf";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = process.argv[2];
if (!root) throw new Error("usage: node tools/prepare_models.mjs <assets-root>");
const out = path.resolve("public/models");
mkdirSync(out, { recursive: true });

await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  "meshopt.decoder": MeshoptDecoder,
  "meshopt.encoder": MeshoptEncoder,
  "draco3d.decoder": await draco3d.createDecoderModule(),
});

const MODELS = [
  { id: "reef_fish", src: "babylon/meshes/fish.glb", tex: 1024,
    credit: "Babylon.js Assets — fish.glb (clownfish, blue tang, yellow tang, moorish idol)", license: "CC-BY-4.0", url: "https://github.com/BabylonJS/Assets" },
  { id: "shark", src: "babylon/meshes/shark.glb", tex: 1024,
    credit: "Babylon.js Assets — shark.glb", license: "CC-BY-4.0", url: "https://github.com/BabylonJS/Assets" },
  { id: "octopus", src: "babylon/meshes/octopus_customRig.glb", tex: 1024,
    credit: "Babylon.js Assets — octopus_customRig.glb", license: "CC-BY-4.0", url: "https://github.com/BabylonJS/Assets" },
  { id: "grey_snapper", src: "babylon/meshes/Demos/UnderWaterScene/fish/greySnapper_vertColor.glb", tex: 512,
    credit: "Babylon.js Assets — Underwater Scene demo, grey snapper", license: "CC-BY-4.0", url: "https://github.com/BabylonJS/Assets" },
  { id: "reef_rocks", src: "babylon/meshes/Demos/UnderWaterScene/underwaterScene.glb", tex: 1024, simplify: 0.5,
    credit: "Babylon.js Assets — Underwater Scene demo (rocks, seagrass, boards)", license: "CC-BY-4.0", url: "https://github.com/BabylonJS/Assets" },
  { id: "barnacle_rocks", src: "babylon/meshes/Demos/UnderWaterScene/underwaterSceneRocksBarnaclesMussels.glb", tex: 1024, simplify: 0.09,
    credit: "Babylon.js Assets — Underwater Scene demo (rocks with barnacles and mussels)", license: "CC-BY-4.0", url: "https://github.com/BabylonJS/Assets" },
  { id: "turtle", src: "pmndrs_examples/examples/aquarium/src/model_52a_-_kemps_ridley_sea_turtle_no_id-transformed.glb", tex: 1024,
    credit: "Model 52A — Kemp's Ridley Sea Turtle, DigitalLife3D (via pmndrs/examples)", license: "CC-BY-NC-4.0", url: "https://sketchfab.com/3d-models/model-52a-kemps-ridley-sea-turtle-no-id-7aba937dfbce480fb3aca47be3a9740b" },
  { id: "crab", src: "gkjohnson_3d-demo-data/models/threedscans/Crab.glb", simplify: 0.012, color: [0.55, 0.2, 0.1],
    credit: "Crab — Three D Scans (via gkjohnson/3d-demo-data)", license: "Three D Scans: free, no restrictions", url: "https://threedscans.com/" },
  { id: "elbow_crab", src: "gkjohnson_3d-demo-data/models/threedscans/Elbow_Crab.glb", simplify: 0.02, color: [0.62, 0.36, 0.22],
    credit: "Elbow Crab — Three D Scans (via gkjohnson/3d-demo-data)", license: "Three D Scans: free, no restrictions", url: "https://threedscans.com/" },
  { id: "barramundi", src: "KhronosGroup_glTF-Sample-Assets/Models/BarramundiFish/glTF-Binary/BarramundiFish.glb", tex: 1024,
    credit: "BarramundiFish — Microsoft, Khronos glTF Sample Assets", license: "CC0-1.0", url: "https://github.com/KhronosGroup/glTF-Sample-Assets" },
  { id: "shipwreck", src: "pmndrs_market-assets/files/models/ship-wreck/model.gltf", tex: 512,
    credit: "Ship wreck — Kenney Pirate Kit (via pmndrs/market-assets)", license: "CC0-1.0", url: "https://kenney.nl/assets/pirate-kit" },
  { id: "rock_arch", src: "pmndrs_market-assets/files/models/formation-large-rock/model.gltf", tex: 512,
    credit: "Large rock formation — Kenney Nature Kit (via pmndrs/market-assets)", license: "CC0-1.0", url: "https://kenney.nl/assets/nature-kit" },
];

const credits = [];
for (const m of MODELS) {
  const src = path.join(root, m.src);
  const doc = await io.read(src);
  const hasSpecGloss = doc.getRoot().listExtensionsUsed().some((e) => e.extensionName === "KHR_materials_pbrSpecularGlossiness");
  const steps = [];
  if (hasSpecGloss) steps.push(metalRough());
  steps.push(dedup(), prune());
  if (m.simplify) {
    steps.push(weld(), simplify({ simplifier: MeshoptSimplifier, ratio: m.simplify, error: m.color ? 0.002 : 0.01 }));
    if (m.color) steps.push(normals({ overwrite: true }));
  }
  if (doc.getRoot().listAnimations().length) steps.push(resample());
  if (doc.getRoot().listTextures().length) {
    steps.push(textureCompress({ encoder: sharp, targetFormat: "webp", resize: [m.tex ?? 1024, m.tex ?? 1024], quality: 82 }));
  }
  await doc.transform(...steps);
  if (m.color) {
    // Scans carry geometry only: give them a plain PBR shell colour.
    let mat = doc.getRoot().listMaterials()[0];
    if (!mat) mat = doc.createMaterial("scan");
    mat.setBaseColorFactor([...m.color, 1]).setRoughnessFactor(0.55).setMetallicFactor(0);
    for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) p.setMaterial(mat);
  }
  // Re-encode everything with meshopt only (one decoder in the browser).
  doc.getRoot().listExtensionsUsed().filter((e) => e.extensionName === "KHR_draco_mesh_compression").forEach((e) => e.dispose());
  await doc.transform(quantize(), meshopt({ encoder: MeshoptEncoder, level: "medium" }));
  const dst = path.join(out, `${m.id}.glb`);
  await io.write(dst, doc);
  credits.push({ id: m.id, credit: m.credit, license: m.license, url: m.url });
  console.log(m.id, "→", dst);
}
writeFileSync(path.join(out, "credits.json"), JSON.stringify(credits, null, 2));
