# Projects a straight-on sole photo into the procedural foot's planar UV space.
# Outputs: sole_albedo.png (RGBA, de-lit) and sole_height.png (LA, high-pass detail).
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

import argparse
ap = argparse.ArgumentParser()
ap.add_argument('src'); ap.add_argument('out_dir'); ap.add_argument('outline')
ap.add_argument('--heel', default='960,420', help='heel end, px')
ap.add_argument('--gap', default=None, help='big/2nd toe gap, px (sets the axis)')
ap.add_argument('--len', type=float, default=0.24 / 0.000171, help='heel→big toe tip length, px')
ap.add_argument('--medial', type=float, default=1, help='+1/-1: which side of the axis the big toe is on')
ap.add_argument('--mag', type=float, default=1.0, help='perspective: image scale at the toes / at the heel')
ap.add_argument('--name', default='sole')
ap.add_argument('--lum', type=float, default=0.6, help='target mean luminance of the albedo')
ap.add_argument('--sat', type=float, default=0.8, help='saturation multiplier')
ap.add_argument('--tint', default='1,1,1', help='per-channel gain r,g,b')
A = ap.parse_args()
src, out_dir = A.src, A.out_dir
sys.argv = [sys.argv[0], src, out_dir, A.outline]
N = 2048
img = np.asarray(Image.open(src).convert('RGB')).astype(np.float32) / 255.0
Hh, Ww, _ = img.shape

H = np.array([float(v) for v in A.heel.split(',')])
if A.gap:
    G = np.array([float(v) for v in A.gap.split(',')]); axis = (G - H) / np.linalg.norm(G - H)
else:
    axis = np.array([-0.568, 0.823])
perp = A.medial * np.array([-axis[1], axis[0]])  # toward the big-toe (medial) side
Y0 = -0.003     # foot-space y of H

# UV grid → foot space (u=(x+0.13)/0.26, v=(y+0.01)/0.26); row 0 is v=1 (canvas flipY).
u = (np.arange(N) + 0.5) / N
v = 1 - (np.arange(N) + 0.5) / N
U, V = np.meshgrid(u, v)
X = U * 0.26 - 0.13
Y = V * 0.26 - 0.01
# Perspective: scale grows linearly from heel (1) to toes (mag).
t = np.clip((Y - Y0) / 0.24, -0.2, 1.2)
k = A.mag - 1
norm = 1 + k / 2
along = A.len * (t + k * t * t / 2) / norm
sidescale = (A.len / 0.24) * (1 + k * t) / norm
side = -X * sidescale  # foot -X (medial) is the photo's big-toe side
PX = H[0] + axis[0] * along + perp[0] * side
PY = H[1] + axis[1] * along + perp[1] * side

def sample(a, px, py):
    px = np.clip(px, 0, Ww - 1.001); py = np.clip(py, 0, Hh - 1.001)
    x0 = np.floor(px).astype(int); y0 = np.floor(py).astype(int)
    fx = (px - x0)[..., None]; fy = (py - y0)[..., None]
    return (a[y0, x0] * (1 - fx) * (1 - fy) + a[y0, x0 + 1] * fx * (1 - fy) + a[y0 + 1, x0] * (1 - fx) * fy + a[y0 + 1, x0 + 1] * fx * fy)

warped = sample(img, PX, PY)

# Sole outline (foot space, metres), shrunk toward the centre and feathered.
import json
outline = [tuple(p) for p in json.load(open(sys.argv[3]))['points']]
cx = np.mean([p[0] for p in outline]); cy = np.mean([p[1] for p in outline])
poly = [((cx + (x - cx) * 0.97 + 0.13) / 0.26 * N, (1 - (cy + (y - cy) * 0.97 + 0.01) / 0.26) * N) for x, y in outline]
m = Image.new('L', (N, N), 0)
ImageDraw.Draw(m).polygon(poly, fill=255)
m = m.filter(ImageFilter.GaussianBlur(24))
alpha = np.asarray(m).astype(np.float32) / 255.0

# Keep only skin-coloured pixels (drops the grey sofa / the other leg's shadowed edge).
r, g, b = warped[..., 0], warped[..., 1], warped[..., 2]
skin = np.clip(((r - b) - 0.05) / 0.07, 0, 1)
# Drop deep shadows (gaps between toes) too.
lum0 = warped @ np.array([0.299, 0.587, 0.114], dtype=np.float32)
med = float(np.median(lum0[alpha > 0.5]))
dark = np.clip((lum0 / med - 0.72) / 0.12, 0, 1)
dark = np.asarray(Image.fromarray((dark * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(9)).filter(ImageFilter.GaussianBlur(10))).astype(np.float32) / 255
skin *= np.where(Y > 0.175, dark, 1.0)  # only the toe-gap band
skin = np.asarray(Image.fromarray((skin * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(12))).astype(np.float32) / 255
alpha *= skin

# De-light: divide out low-frequency shading, keep colour + fine detail.
lum = warped @ np.array([0.299, 0.587, 0.114], dtype=np.float32)
def blur(a, s):
    im = Image.fromarray(np.clip(a * 255, 0, 255).astype(np.uint8))
    return np.asarray(im.filter(ImageFilter.GaussianBlur(s))).astype(np.float32) / 255
# Normalized blur inside the foot only, so the bright sofa does not leak into the shading.
w = np.clip(alpha, 0, 1)
shade = blur(lum * w, 60) / (blur(w, 60) + 1e-3) + 1e-3
inside = alpha > 0.5
target = float(np.percentile(lum[inside], 65))
albedo = np.clip(warped * (target / shade)[..., None], 0, 1)
print('photo skin #%02x%02x%02x' % tuple(int(c * 255) for c in warped[inside].mean(axis=0)))
# Exposure → plausible skin albedo (mean luminance ≈ 0.6 in sRGB).
albedo = np.clip(albedo * (A.lum / float((albedo[inside] @ np.array([0.299, 0.587, 0.114])).mean())) * np.array([float(v) for v in A.tint.split(',')], dtype=np.float32), 0, 1)
# Phone photos under warm light are over-saturated; pull 20% toward grey.
gray = (albedo @ np.array([0.299, 0.587, 0.114], dtype=np.float32))[..., None]
albedo = np.clip(gray + (albedo - gray) * A.sat, 0, 1)
mean_rgb = albedo[inside].mean(axis=0)
print('skin tone #%02x%02x%02x' % tuple(int(c * 255) for c in mean_rgb))

# High-pass luminance = creases & pores → height detail around 0.5.
hp = lum - blur(lum, 4)
hp = np.clip(0.5 + hp * 4.0, 0, 1)

# Fade the colour toward the average skin where the photo is masked out (no dark fringes).
fa = np.clip(alpha * 1.6, 0, 1)[..., None]
albedo = albedo * fa + mean_rgb[None, None, :] * (1 - fa)
a8 = (alpha * 255).astype(np.uint8)
Image.fromarray(np.dstack([(albedo * 255).astype(np.uint8), a8])).save(f'{out_dir}/{A.name}_albedo.webp', 'WEBP', quality=88)
h8 = (hp * 255).astype(np.uint8)
Image.fromarray(np.dstack([h8, h8, h8, a8])).save(f'{out_dir}/{A.name}_height.webp', 'WEBP', quality=90)
# Preview: albedo over a checker so coverage is visible.
prev = Image.fromarray(np.dstack([(albedo * 255).astype(np.uint8), a8])).resize((512, 512))
bg = Image.new('RGB', (512, 512), (40, 40, 60)); bg.paste(prev, (0, 0), prev)
for x, y in poly: pass
bg.save(f'{out_dir}/{A.name}_preview.png')
