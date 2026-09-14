# docs/

`index.html` — собранный одним файлом навигатор (см. `navigator/build-single.mjs`).
Папка существует ради GitHub Pages: в **Settings → Pages** достаточно выбрать
эту ветку и папку `/docs`, и приложение окажется по адресу
`https://<логин>.github.io/pupa/` — по HTTPS, то есть с работающей
геолокацией и установкой на телефон.

Файл генерируется, править его руками не нужно:

```bash
cd navigator && node build-single.mjs ../docs/index.html
```
