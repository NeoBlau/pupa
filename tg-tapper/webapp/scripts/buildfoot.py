# CC0 base foot (opengameart.org/content/human-foot-3d-model) → game asset fitted to the
# reference outline. Writes foot.bin (positions, normals, uvs, paintMask, indices) + foot.json.
import sys, json, math
import numpy as np
sys.path.insert(0, sys.argv[1])
from meshview import load_obj, catmull_clark, render
src, outline_json, out_dir, levels = sys.argv[2], sys.argv[3], sys.argv[4], int(sys.argv[5])
# Per-model toe profile (measured on that model's photos), toes ordered big → little:
#   len: overall toe length factor past the web; rel: tip offset vs the big toe in % of foot length;
#   fat: extra plumpness per toe.
PROF = json.loads(open(sys.argv[6]).read()) if len(sys.argv) > 6 else {}

V, F = load_obj(src)
for _ in range(levels): V, F = catmull_clark(V, F)
L = 0.24
s = L / (V[:, 2].max() - V[:, 2].min())
P = np.stack([-V[:, 0] * s, (V[:, 2] - V[:, 2].min()) * s, -V[:, 1] * s], 1)
P[:, 2] -= P[:, 2].max()

# Width profile of the base sole vs the traced outline → per-y warp of X.
ys = np.linspace(0.0, 0.2, 41)
def prof_mesh(Q):
    lo, hi = [], []
    for y in ys:
        band = Q[(np.abs(Q[:, 1] - y) < 0.004) & (Q[:, 2] > -0.012)]
        lo.append(band[:, 0].min()); hi.append(band[:, 0].max())
    return np.array(lo), np.array(hi)
pts = np.array(json.load(open(outline_json))['points'])
def prof_outline():
    lo, hi = [], []
    for y in ys:
        band = pts[np.abs(pts[:, 1] - y) < 0.004]
        if len(band) < 2:
            lo.append(np.nan); hi.append(np.nan); continue
        lo.append(band[:, 0].min()); hi.append(band[:, 0].max())
    lo, hi = np.array(lo), np.array(hi)
    ok = ~np.isnan(lo)
    return np.interp(ys, ys[ok], lo[ok]), np.interp(ys, ys[ok], hi[ok])
blo, bhi = prof_mesh(P)
tlo, thi = prof_outline()
k = np.clip((thi - tlo) / (bhi - blo), 0.8, 1.2)
# Rounded heel end: width comparison is unstable there, hold the heel value.
k[ys < 0.03] = k[np.argmin(np.abs(ys - 0.03))]
k = np.convolve(np.pad(k, 3, mode='edge'), np.ones(7) / 7, mode='valid')
bc = (bhi + blo) / 2; tc = (thi + tlo) / 2
bc = np.convolve(np.pad(bc, 3, mode='edge'), np.ones(7) / 7, mode='valid')
tc = np.convolve(np.pad(tc, 3, mode='edge'), np.ones(7) / 7, mode='valid')
yq = np.clip(P[:, 1], ys[0], ys[-1])
P[:, 0] = np.interp(yq, ys, tc) + (P[:, 0] - np.interp(yq, ys, bc)) * np.interp(yq, ys, k)
print('scale k heel..ball', np.round(k[[2, 6, 12, 20, 30, 38]], 3))

# Plumper toes, closer together (reference toes are fuller than the base mesh).
tm = P[:, 1] > 0.175
tx = P[tm]
cx0 = np.array(sorted(np.quantile(tx[:, 0], [0.1, 0.3, 0.5, 0.7, 0.9])))
for _ in range(20):
    lab0 = np.argmin(np.abs(tx[:, 0:1] - cx0[None]), axis=1)
    cx0 = np.array([tx[lab0 == i, 0].mean() for i in range(5)])
zc0 = np.array([(tx[lab0 == i, 2].max() + tx[lab0 == i, 2].min()) / 2 for i in range(5)])
w = np.clip((tx[:, 1] - 0.175) / 0.02, 0, 1)
# Smooth partition of unity over toes (no hard assignment → no tearing between toes).
dx = tx[:, 0:1] - cx0[None]
wt = np.exp(-(dx / 0.0045) ** 2); wt /= wt.sum(1, keepdims=True) + 1e-12
fat = np.array(PROF.get('fat', [0.16, 0.1, 0.1, 0.1, 0.1]))[None]  # cx0 ascending = big toe first
cxs = (wt * cx0[None]).sum(1); zcs = (wt * zc0[None]).sum(1); scs = 1 + (wt * fat).sum(1) * w
# spread toe centres a little so fuller toes touch instead of intersecting
mid = cx0.mean()
tx[:, 0] = (mid + (cxs - mid) * (1 + 0.08 * w)) + (tx[:, 0] - cxs) * scs
tx[:, 2] = zcs + (tx[:, 2] - zcs) * scs
base_y = 0.175
# Toe length: the reference toes (top view) are ~30% longer past the web than the base mesh.
TOE_LEN = float(PROF.get('len', 1.12))
tx[:, 1] = np.where(tx[:, 1] > base_y, base_y + (tx[:, 1] - base_y) * TOE_LEN, tx[:, 1])
def pick5(pk, reach, bins, sep=0.0085):
    # Highest peaks first, skipping any closer than `sep` to one already taken (toes are ~1 cm apart).
    out = []
    for k in sorted(pk, key=lambda k: -reach[k]):
        if all(abs(bins[k] - bins[j]) >= sep for j in out): out.append(k)
        if len(out) == 5: break
    return sorted(out)

# Per-toe length: stretch each toe (smoothly weighted) so its tip lands where the photo has it.
if 'rel' in PROF:
    # Toe tips = peaks of the "how far forward" profile across the width (same as below).
    bins = np.arange(tx[:, 0].min(), tx[:, 0].max(), 0.0012)
    reach = np.array([tx[(tx[:, 0] >= b) & (tx[:, 0] < b + 0.0012), 1].max() if ((tx[:, 0] >= b) & (tx[:, 0] < b + 0.0012)).any() else 0 for b in bins])
    reach = np.convolve(np.pad(reach, 2, mode='edge'), np.ones(5) / 5, mode='valid')
    pk = [k for k in range(1, len(reach) - 1) if reach[k] >= reach[k - 1] and reach[k] > reach[k + 1]]
    pk = pick5(pk, reach, bins)
    cc = np.array([bins[k] + 0.0006 for k in pk]); tips = np.array([reach[k] for k in pk])
    print('tips before', np.round(tips, 4), 'x', np.round(cc, 4))
    dx = tx[:, 0:1] - cc[None]
    target = tips[0] + np.array(PROF['rel']) / 100 * 0.248
    sc = np.clip((target - base_y) / (tips - base_y), 0.7, 1.5)
    wt2 = np.exp(-(dx / (np.diff(cc).min() * 0.45)) ** 2); wt2 /= wt2.sum(1, keepdims=True) + 1e-12
    s_v = (wt2 * sc[None]).sum(1)
    tx[:, 1] = np.where(tx[:, 1] > base_y, base_y + (tx[:, 1] - base_y) * s_v, tx[:, 1])
    print('toe scale', np.round(sc, 3))
P[tm] = tx

# Triangulate quads, flip winding (the mirror above), smooth normals.
tris = []
for f in F:
    for i in range(1, len(f) - 1):
        tris.append([f[0], f[i + 1], f[i]])
T = np.array(tris, dtype=np.uint32)
N = np.zeros_like(P)
fn = np.cross(P[T[:, 1]] - P[T[:, 0]], P[T[:, 2]] - P[T[:, 0]])
for j in range(3): np.add.at(N, T[:, j], fn)
N /= np.linalg.norm(N, axis=1, keepdims=True) + 1e-12
if (N[:, 2][P[:, 2] > -0.005]).mean() < 0:  # sole normals must face +Z
    T = T[:, [0, 2, 1]]; N = -N

UV = np.stack([(P[:, 0] + 0.13) / 0.26, (P[:, 1] + 0.01) / 0.26], 1)
mask = np.clip((N[:, 2] + 0.15) / 0.75, 0, 1); mask = mask * mask * (3 - 2 * mask)
mask *= np.clip((P[:, 2] + 0.03) / 0.02, 0, 1)  # only near the sole plane

# Toe tips = the 5 peaks of the "how far forward" profile across the width.
front = P[P[:, 1] > 0.15]
bins = np.arange(front[:, 0].min(), front[:, 0].max(), 0.0012)
reach = np.array([front[(front[:, 0] >= b) & (front[:, 0] < b + 0.0012), 1].max() if ((front[:, 0] >= b) & (front[:, 0] < b + 0.0012)).any() else 0 for b in bins])
reach = np.convolve(np.pad(reach, 2, mode='edge'), np.ones(5) / 5, mode='valid')
peaks = [i for i in range(1, len(reach) - 1) if reach[i] >= reach[i - 1] and reach[i] > reach[i + 1]]
peaks = pick5(peaks, reach, bins)
c = np.array([bins[i] + 0.0006 for i in peaks])
print('tips x', np.round(c, 4), 'y', np.round([reach[i] for i in peaks], 4))
toe = P[P[:, 1] > 0.17]
lab = np.argmin(np.abs(toe[:, 0:1] - c[None]), axis=1)
toes = []
gap = np.diff(np.sort(c))
for i in np.argsort(c):
    Q = toe[lab == i]
    tip = Q[np.argmax(Q[:, 1])]
    r = (Q[:, 0].max() - Q[:, 0].min()) / 2
    k_ = list(np.argsort(c)).index(i)
    near_gap = min([gap[j] for j in (k_ - 1, k_) if 0 <= j < len(gap)])
    r = min(r, near_gap * (0.62 if k_ == 0 else 0.5))
    zc = (Q[:, 2].max() + Q[:, 2].min()) / 2
    b = [float(Q[:, 0].mean()), float(tip[1] - r), float(zc)]
    a = [float(Q[:, 0].mean()), float(Q[:, 1].min() - 0.008), float(zc)]
    # Nail: highest (most dorsal) part of this toe's own vertices, just behind the tip.
    band = Q[(Q[:, 1] > tip[1] - r * 1.4) & (Q[:, 1] < tip[1] - r * 0.4)]
    mx = Q[:, 0].mean()
    near = band[np.abs(band[:, 0] - mx) < r * 0.35]
    nc = np.array([mx, tip[1] - r * 0.9, near[:, 2].min() if len(near) else band[:, 2].min()]); nn = np.array([0, 0.35, -0.94])
    toes.append({'a': a, 'b': b, 'r': float(r), 'nail': nc.tolist(), 'nailN': nn.tolist()})
print('toes x', [round(t['b'][0], 3) for t in toes], 'r', [round(t['r'], 4) for t in toes])

with open(f'{out_dir}/foot.bin', 'wb') as fh:
    for arr, dt in ((P, np.float32), (N, np.float32), (UV, np.float32), (mask, np.float32), (T.reshape(-1), np.uint32)):
        fh.write(np.ascontiguousarray(arr, dtype=dt).tobytes())
meta = {'vertices': int(len(P)), 'indices': int(T.size), 'toes': toes, 'ankle': [0.005, 0.065, -0.08],
        'source': 'CC0 base mesh by byzmod3d, opengameart.org/content/human-foot-3d-model; fitted to reference outline'}
json.dump(meta, open(f'{out_dir}/foot.json', 'w'), indent=1)
print('verts', len(P), 'tris', len(T))
