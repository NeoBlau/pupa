# Генерация объявлений на русском языке (Piper TTS, голоса ru_RU dmitri — мужской, irina — женский).
# Запуск: python3 tools/gen_announcements.py <путь к piper> <каталог голосов>
# Результат: public/assets/audio/{m,f}/<ключ>.mp3 и public/assets/audio/manifest.json
import json, os, subprocess, sys, hashlib
here = os.path.dirname(os.path.abspath(__file__))
root = os.path.join(here, '..')
piper, voices = sys.argv[1], sys.argv[2]
lines = json.load(open(os.path.join(root, 'src', 'data', 'lines.json'), encoding='utf-8'))['lines']
out = os.path.join(root, 'public', 'assets', 'audio')
VOICE = {'m': 'ru_RU-dmitri-medium.onnx', 'f': 'ru_RU-irina-medium.onnx'}
# Ударения для TTS (знак + перед ударной гласной в Piper не поддерживается — используем «ё» и правку написания)
FIX = {}
phr = {}
def add(k, t): phr[k] = t
add('doors', 'Осторожно, двери закрываются.')
add('terminal', 'Конечная. Поезд дальше не идёт. Просьба выйти из вагонов.')
add('forget', 'Уважаемые пассажиры! Выходя из вагона, не забывайте свои вещи.')
add('welcome', 'Уважаемые пассажиры! Добро пожаловать на Московские центральные диаметры.')
add('smoking', 'Уважаемые пассажиры! Курение в поездах и на платформах запрещено.')
add('hold', 'Уважаемые пассажиры! Поезд скоро отправится. Просьба не держать двери.')
for L in lines.values():
    for st in L['stations']:
        n = st['name']
        add(f"next_{st['id']}", f'Следующая станция — {n}.')
        add(f"arr_{st['id']}", f'Станция {n}.')
        if st['transfer']: add(f"tr_{st['id']}", st['transfer'])
    for term in (L['stations'][0], L['stations'][-1]):
        add(f"to_{L['id']}_{term['id']}", f"Поезд следует до станции {term['name']}. {L['name']}, {L['full']} диаметр.")
os.makedirs(out, exist_ok=True)
manifest = {}
for v, model in VOICE.items():
    d = os.path.join(out, v); os.makedirs(d, exist_ok=True)
    for k, t in phr.items():
        mp3 = os.path.join(d, k + '.mp3')
        manifest[k] = t
        if os.path.exists(mp3): continue
        wav = mp3[:-4] + '.wav'
        subprocess.run([piper, '-m', os.path.join(voices, model), '-f', wav, '--length_scale', '1.05', '--sentence_silence', '0.25'], input=t.encode('utf-8'), check=True, stderr=subprocess.DEVNULL)
        # «станционная» окраска: полоса громкоговорителя и лёгкая реверберация
        subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', wav, '-af', 'highpass=f=240,lowpass=f=6200,aecho=0.8:0.5:45:0.18,volume=1.6', '-ac', '1', '-ar', '24000', '-b:a', '48k', mp3], check=True)
        os.remove(wav)
    print('voice', v, 'done')
json.dump(manifest, open(os.path.join(out, 'manifest.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(len(manifest), 'фраз')
