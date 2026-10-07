# Геокодирование станций МЦД через Nominatim (OSM).
# Для каждой станции сохраняем всех кандидатов (tools/geocode_candidates.json);
# выбор нужного кандидата по линии делает tools/build_lines.py.
import json, time, urllib.request, urllib.parse, sys, os
here = os.path.dirname(os.path.abspath(__file__))
src = json.load(open(os.path.join(here, 'stations_src.json'), encoding='utf-8'))
cand_path = os.path.join(here, 'geocode_candidates.json')
cands = json.load(open(cand_path, encoding='utf-8')) if os.path.exists(cand_path) else {}
UA = {'User-Agent': 'mcd-sim personal project (geocoding railway stations)'}
def q(query):
    url = 'https://nominatim.openstreetmap.org/search?' + urllib.parse.urlencode({'q': query, 'format': 'json', 'limit': 15, 'viewbox': '36.6,56.2,38.5,55.2', 'bounded': 1})
    for i in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40) as r:
                res = json.load(r)
            time.sleep(1.1)
            return res
        except Exception as e:
            print('ERR', query, e, file=sys.stderr); time.sleep(3 * (i + 1))
    return []
RAIL = ('station', 'halt', 'platform', 'stop_area', 'stop_position')
names = []
for line in src.values():
    for s in line['stations']:
        if s not in names: names.append(s)
for n in names:
    if cands.get(n): continue
    found = {}
    for query in [f'станция {n}', f'платформа {n}', n]:
        for r in q(query):
            if r.get('class') in ('railway', 'public_transport') or r.get('type') in RAIL:
                key = f"{r['osm_type']}/{r['osm_id']}"
                found[key] = {'lat': float(r['lat']), 'lon': float(r['lon']), 'type': r['type'], 'cls': r['class'], 'name': r.get('display_name', '')[:140]}
        if len(found) >= 4: break
    cands[n] = list(found.values())
    print(n, len(cands[n]), flush=True)
    json.dump(cands, open(cand_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
