# Сборка src/data/lines.json из списка станций (stations_src.json) и кандидатов геокодирования.
# Для каждой станции выбираем кандидата, ближайшего к соседним станциям линии.
# Станции без надёжных координат интерполируются и помечаются approx=true.
import json, math, os
here = os.path.dirname(os.path.abspath(__file__))
src = json.load(open(os.path.join(here, 'stations_src.json'), encoding='utf-8'))
cands = json.load(open(os.path.join(here, 'geocode_candidates.json'), encoding='utf-8'))
LAT0, LON0 = 55.7558, 37.6176  # центр Москвы — начало локальной системы координат
KX = 111320 * math.cos(math.radians(LAT0))
KZ = 110540

TR = dict(zip('абвгдеёжзийклмнопрстуфхцчшщъыьэюя', ['a','b','v','g','d','e','e','zh','z','i','y','k','l','m','n','o','p','r','s','t','u','f','h','ts','ch','sh','sch','','y','','e','yu','ya']))
def slug(n):
    s = ''.join(TR.get(c, c) for c in n.lower())
    return ''.join(c if c.isalnum() else '_' for c in s).strip('_')

def km(a, b):
    return math.hypot((a['lat'] - b['lat']) * 111.2, (a['lon'] - b['lon']) * 111.2 * math.cos(math.radians(LAT0)))

RAILTYPES = {'station': 0, 'halt': 0, 'stop_area': 0.3, 'platform': 0.2, 'stop_position': 0.4}
def penalty(c, n=''):
    p = RAILTYPES.get(c['type'], 1.0) + (0 if c['cls'] in ('railway', 'public_transport') else 1.0)
    first = c.get('name', '').split(',')[0].strip().lower().replace('ё', 'е')
    if n and not first.startswith(n.lower().replace('ё', 'е')[:5]): p += 4
    return p

TRANSFERS = {
    'Белорусская': 'Переход на станцию метро «Белорусская» Кольцевой и Замоскворецкой линий.',
    'Савёловская': 'Переход на станцию метро «Савёловская».',
    'Тимирязевская': 'Переход на станцию метро «Тимирязевская».',
    'Окружная': 'Переход на станцию Окружная Московского центрального кольца и метро.',
    'Кунцевская': 'Переход на станцию метро «Кунцевская».',
    'Фили': 'Переход на станцию метро «Фили».',
    'Славянский бульвар': 'Переход на станцию метро «Славянский бульвар».',
    'Рижская': 'Переход на станцию метро «Рижская».',
    'Курская': 'Переход на станции метро «Курская».',
    'Каланчёвская': 'Переход на станцию метро «Комсомольская».',
    'Текстильщики': 'Переход на станцию метро «Текстильщики».',
    'Царицыно': 'Переход на станцию метро «Царицыно».',
    'Выхино': 'Переход на станцию метро «Выхино».',
    'Электрозаводская': 'Переход на станцию метро «Электрозаводская».',
    'Авиамоторная': 'Переход на станцию метро «Авиамоторная».',
    'Тушинская': 'Переход на станцию метро «Тушинская».',
    'Стрешнево': 'Переход на станцию Стрешнево Московского центрального кольца.',
    'Дмитровская': 'Переход на станцию метро «Дмитровская».',
    'Нижегородская': 'Переход на станцию Нижегородская Московского центрального кольца и метро.',
    'Новохохловская': 'Переход на станцию Новохохловская Московского центрального кольца.',
    'Лихоборы': 'Переход на станцию Лихоборы Московского центрального кольца.',
    'Петровско-Разумовская': 'Переход на станцию метро «Петровско-Разумовская».',
    'Ховрино': 'Переход на станцию метро «Ховрино».',
}
HUBS = {'Белорусская', 'Савёловская', 'Рижская', 'Курская', 'Каланчёвская', 'Киевская', 'Тестовская', 'Подольск', 'Одинцово', 'Лобня', 'Нахабино', 'Раменское', 'Люберцы', 'Крюково', 'Царицыно', 'Выхино', 'Апрелевка', 'Железнодорожная'}

out = {'origin': {'lat': LAT0, 'lon': LON0}, 'lines': {}}
for lid, L in src.items():
    names = L['stations']
    chosen = [None] * len(names)
    # первый проход: однозначные кандидаты
    for i, n in enumerate(names):
        cs = cands.get(n) or []
        if len(cs) == 1: chosen[i] = cs[0]
    # итеративно уточняем по соседям
    for _ in range(4):
        for i, n in enumerate(names):
            cs = cands.get(n) or []
            if not cs: continue
            neigh = [chosen[j] for j in (i - 1, i + 1) if 0 <= j < len(names) and chosen[j]]
            if not neigh:
                neigh = [c for j in (i - 1, i + 1) if 0 <= j < len(names) for c in (cands.get(names[j]) or [])]
            if not neigh:
                chosen[i] = min(cs, key=lambda c: penalty(c, n)); continue
            chosen[i] = min(cs, key=lambda c: min(km(c, nb) for nb in neigh) + penalty(c, n) * 0.8)
    stations = []
    for i, n in enumerate(names):
        c = chosen[i]
        approx = False
        if c:
            nb = [chosen[j] for j in (i - 1, i + 1) if 0 <= j < len(names) and chosen[j]]
            if nb and min(km(c, x) for x in nb) > 9: c = None
        if not c: approx = True
        stations.append({'name': n, 'c': c, 'approx': approx})
    # интерполяция пропусков
    for i, st in enumerate(stations):
        if st['c']: continue
        a = next((j for j in range(i - 1, -1, -1) if stations[j]['c']), None)
        b = next((j for j in range(i + 1, len(stations)) if stations[j]['c']), None)
        if a is not None and b is not None:
            t = (i - a) / (b - a)
            ca, cb = stations[a]['c'], stations[b]['c']
            st['c'] = {'lat': ca['lat'] + (cb['lat'] - ca['lat']) * t, 'lon': ca['lon'] + (cb['lon'] - ca['lon']) * t}
        elif a is not None:
            ca = stations[a]['c']; st['c'] = {'lat': ca['lat'] + 0.01, 'lon': ca['lon']}
        elif b is not None:
            cb = stations[b]['c']; st['c'] = {'lat': cb['lat'] - 0.01, 'lon': cb['lon']}
    res = []
    for st in stations:
        c = st['c']
        x = (c['lon'] - LON0) * KX
        z = -(c['lat'] - LAT0) * KZ
        dist_center = math.hypot(x, z)
        res.append({
            'id': slug(st['name']), 'name': st['name'],
            'lat': round(c['lat'], 6), 'lon': round(c['lon'], 6), 'x': round(x, 1), 'z': round(z, 1),
            'approx': st['approx'], 'hub': st['name'] in HUBS, 'city': dist_center < 14000,
            'transfer': TRANSFERS.get(st['name'], ''),
        })
    total = sum(math.hypot(res[i]['x'] - res[i - 1]['x'], res[i]['z'] - res[i - 1]['z']) for i in range(1, len(res)))
    out['lines'][lid] = {'id': lid, 'name': L['name'], 'full': L['full'], 'color': L['color'], 'from': L['from'], 'to': L['to'], 'stations': res, 'approxKm': round(total / 1000, 1)}
    bad = [s['name'] for s in res if s['approx']]
    print(lid, len(res), 'станций, ~', round(total / 1000, 1), 'км; приблизительно:', ', '.join(bad) or '—')

os.makedirs(os.path.join(here, '..', 'src', 'data'), exist_ok=True)
json.dump(out, open(os.path.join(here, '..', 'src', 'data', 'lines.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
