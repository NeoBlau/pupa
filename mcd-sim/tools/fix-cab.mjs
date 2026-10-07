// Кабина Desiro: карта ORM (AO/шероховатость/металл) развёрнута во втором UV-канале,
// но в исходном glTF указан texCoord 0. Исправляем и сохраняем без prune второго канала.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { textureCompress } from '@gltf-transform/functions';
import sharp from 'sharp';
const [, , inp, out] = process.argv;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(inp);
for (const m of doc.getRoot().listMaterials()) {
  const orm = m.getOcclusionTexture();
  if (orm && m.getOcclusionTextureInfo()) m.getOcclusionTextureInfo().setTexCoord(1);
  if (m.getMetallicRoughnessTexture() && m.getMetallicRoughnessTexture() === orm) m.getMetallicRoughnessTextureInfo().setTexCoord(1);
}
await doc.transform(textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024] }));
await io.write(out, doc);
console.log('ok');
