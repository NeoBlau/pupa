# Как выложить в сеть

Приложение — статика. Сборки нет, поэтому подойдёт любой хостинг, отдающий
файлы по HTTPS. HTTPS обязателен: без него не работают геолокация, service
worker и установка на телефон.

Публиковать нужно содержимое папки `navigator/`.

## Самый быстрый способ: GitHub Pages

В репозитории уже лежит `docs/index.html` — весь навигатор одним файлом.

**Settings → Pages → Source: Deploy from a branch**, ветка
`claude/web-navigator-offline-zg1jom`, папка `/docs` → Save.

Через минуту приложение будет по адресу `https://<логин>.github.io/pupa/`.
Ничего ставить не нужно, HTTPS есть, значит работают геолокация, офлайн-кэш и
установка на домашний экран.

Пересобрать этот файл после правок:

```bash
cd navigator && node build-single.mjs ../docs/index.html
```

## Один файл без хостинга

`navigator/dist/compass.html` (собирается `node build-single.mjs`) содержит
всё: MapLibre, стили, весь код, иконки и манифест. Его можно переслать себе
и открыть из «Файлов».

Важное ограничение: **Safari на iOS выдаёт геолокацию только на HTTPS-origin**.
Открытый с файла навигатор покажет карту, поиск и построит маршрут, но не
будет вести вас — синей точки не появится, и хранилище офлайн-регионов Safari
на `file://` тоже не даёт. Приложение само об этом предупреждает плашкой внизу.
Для полноценной работы файл нужно положить на любой https-адрес.

## Vercel

```bash
cd navigator
npx vercel          # предпросмотр
npx vercel --prod   # боевой домен
```

Либо через интерфейс: **Add New → Project → импорт репозитория**, в настройках
указать **Root Directory = `navigator`**. Framework Preset — **Other**, команды
сборки не нужны.

Если Vercel пишет «You need to add a Login Connection to your GitHub account» —
зайдите в *Settings → Authentication* и подключите GitHub. После этого импорт
репозитория станет доступен.

`vercel.json` уже лежит рядом: он отдаёт `sw.js` с заголовком
`Service-Worker-Allowed: /` и кэширует `vendor/` навсегда.

## Netlify

```bash
cd navigator
npx netlify-cli deploy --dir . --prod
```

## GitHub Pages

Settings → Pages → Source: *Deploy from a branch*, ветка и папка `/navigator`.
Учтите, что сайт окажется на подпути `/pupa/navigator/` — все пути в приложении
относительные, так что это работает.

## Свой nginx

```nginx
server {
    listen 443 ssl http2;
    root /var/www/navigator;
    index index.html;

    location = /sw.js {
        add_header Service-Worker-Allowed "/";
        add_header Cache-Control "no-cache";
    }
    location /vendor/ {
        add_header Cache-Control "public, max-age=31536000, immutable";
    }
    location / { try_files $uri $uri/ /index.html; }
}
```

## Проверка после выкладки

1. Откройте сайт на телефоне, разрешите геолокацию.
2. Постройте маршрут — он должен строиться онлайн.
3. Зайдите в **Офлайн-карты**, скачайте текущую область.
4. Включите авиарежим и постройте маршрут снова. Он должен построиться,
   а в карточке появиться метка «Офлайн».
5. «Поделиться → На экран «Домой»» — приложение ставится как обычное.
