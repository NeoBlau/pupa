#!/usr/bin/env bash
#
# hysteria2.sh — установка и управление сервером Hysteria 2 на Ubuntu 22.04/24.04.
#
#   install       поставить сервер и создать первого клиента
#   add NAME      добавить клиента
#   del NAME      удалить клиента
#   list          список клиентов
#   show NAME     ссылка hy2://, QR-код и YAML-конфиг клиента
#   key [NAME]    только ссылка hy2:// одной строкой, для копирования
#   status        состояние сервиса
#   repair        пересобрать конфиг и права, если сервис не стартует
#   uninstall     снести всё
#
# Подробности и разбор флагов — в vpn/README.md рядом.

set -euo pipefail

CONF_DIR=/etc/hysteria
CONFIG="$CONF_DIR/config.yaml"
ENV_FILE="$CONF_DIR/setup.env"
USERS_FILE="$CONF_DIR/users.tsv"
CERT="$CONF_DIR/cert.crt"
KEY="$CONF_DIR/private.key"
CLIENT_DIR=/root/hysteria-clients

log()  { printf '\033[1;32m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[!]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[x]\033[0m %s\n' "$*" >&2; exit 1; }

need_root() {
  [[ ${EUID:-$(id -u)} -eq 0 ]] || die "Запускай от root: sudo $0 $*"
}

# Без "| head -c" на конце: head закрывает пайп, tr ловит SIGPIPE,
# и под set -o pipefail это роняет весь скрипт на ровном месте.
rand_str() {
  local n=${1:-24} s=''
  while (( ${#s} < n )); do
    s+=$(LC_ALL=C tr -dc 'A-Za-z0-9' < <(head -c $(( n * 8 )) /dev/urandom))
  done
  printf '%s' "${s:0:n}"
}

# Имя клиента идёт в YAML-ключ и в имя файла, поэтому алфавит режем жёстко.
sanitize_name() {
  local raw=$1
  local n="${raw//[^A-Za-z0-9_-]/_}"
  [[ -n $n ]] || die "Пустое имя клиента"
  [[ $n == "$raw" ]] || warn "Имя '$raw' приведено к '$n' — в ключах конфига только латиница, цифры, _ и -."
  printf '%s' "$n"
}

urlencode() {
  local s=$1 out='' i c
  for (( i = 0; i < ${#s}; i++ )); do
    c=${s:i:1}
    case $c in
      [A-Za-z0-9.~_-]) out+=$c ;;
      *) out+=$(printf '%%%02X' "'$c") ;;
    esac
  done
  printf '%s' "$out"
}

# Сервис работает не от root, а от системного пользователя hysteria.
# Поэтому /etc/hysteria должен быть доступен его группе, иначе сервис
# не сможет даже войти в каталог и упадёт с "failed to read server config".
svc_user() {
  local u=${HY_SVC_USER:-hysteria}
  id -u "$u" >/dev/null 2>&1 && { printf '%s' "$u"; return; }
  printf 'root'
}

fix_perms() {
  local u; u=$(svc_user)

  chown "root:$u" "$CONF_DIR" 2>/dev/null || true
  chmod 750 "$CONF_DIR"

  # Конфиг и ключ читает сервис — отдаём по группе, но не всему миру.
  local f
  for f in "$CONFIG" "$KEY"; do
    [[ -e $f ]] || continue
    chown "root:$u" "$f" 2>/dev/null || true
    chmod 640 "$f"
  done
  if [[ -e $CERT ]]; then
    chown "root:$u" "$CERT" 2>/dev/null || true
    chmod 644 "$CERT"
  fi

  # А это сервису не нужно вообще: пароли клиентов и параметры установки.
  for f in "$ENV_FILE" "$USERS_FILE"; do
    [[ -e $f ]] || continue
    chown root:root "$f" 2>/dev/null || true
    chmod 600 "$f"
  done
}

# ---------------------------------------------------------------- проверки ---

check_os() {
  [[ -r /etc/os-release ]] || die "Не вижу /etc/os-release — это точно Ubuntu?"
  # shellcheck disable=SC1091
  . /etc/os-release
  case "${ID:-}" in
    ubuntu|debian) : ;;
    *) warn "Скрипт рассчитан на Ubuntu/Debian, у тебя ${PRETTY_NAME:-неизвестно}. Продолжаю, но за apt не ручаюсь." ;;
  esac
}

# Публичный IP нужен и для self-signed режима, и для проверки A-записи домена.
detect_ip() {
  local ip
  for url in https://api.ipify.org https://ifconfig.me/ip https://icanhazip.com; do
    ip=$(curl -fsS --max-time 8 "$url" 2>/dev/null | tr -d '[:space:]') || continue
    [[ $ip =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] && { printf '%s' "$ip"; return 0; }
  done
  ip=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src") print $(i+1); exit}')
  [[ -n $ip ]] || die "Не смог определить внешний IP. Передай его флагом --ip <адрес>."
  printf '%s' "$ip"
}

port_is_busy() {
  local port=$1 proto=$2
  if command -v ss >/dev/null 2>&1; then
    case $proto in
      udp) ss -H -lnu "sport = :$port" 2>/dev/null | grep -q . ;;
      tcp) ss -H -lnt "sport = :$port" 2>/dev/null | grep -q . ;;
    esac
  else
    return 1
  fi
}

# -------------------------------------------------------------- генерация ----

write_config() {
  # shellcheck disable=SC1090
  . "$ENV_FILE"

  local tls_block
  if [[ $HY_MODE == acme ]]; then
    tls_block=$(cat <<EOF
acme:
  domains:
    - $HY_DOMAIN
  email: $HY_EMAIL
  type: http
  dir: /var/lib/hysteria/acme
EOF
)
  else
    tls_block=$(cat <<EOF
tls:
  cert: $CERT
  key: $KEY
EOF
)
  fi

  local obfs_block=''
  if [[ -n ${HY_OBFS_PASS:-} ]]; then
    obfs_block=$(cat <<EOF

obfs:
  type: salamander
  salamander:
    password: $HY_OBFS_PASS
EOF
)$'\n'
  fi

  # Пользователи: по строке "имя<TAB>пароль" в users.tsv → map в auth.userpass.
  local userpass=''
  local name pass
  while IFS=$'\t' read -r name pass; do
    [[ -n ${name:-} ]] || continue
    userpass+="    $name: $pass"$'\n'
  done < "$USERS_FILE"
  [[ -n $userpass ]] || die "Нет ни одного клиента в $USERS_FILE"

  umask 077
  cat > "$CONFIG" <<EOF
# Сгенерировано hysteria2.sh — правки перезапишутся при add/del.
listen: :$HY_PORT

$tls_block
$obfs_block
auth:
  type: userpass
  userpass:
$userpass
# Кто постучится в сервер обычным браузером — увидит этот сайт, а не ошибку.
masquerade:
  type: proxy
  proxy:
    url: $HY_MASQ_URL
    rewriteHost: true
  listenHTTPS: :$HY_PORT

quic:
  initStreamReceiveWindow: 8388608
  maxStreamReceiveWindow: 8388608
  initConnReceiveWindow: 20971520
  maxConnReceiveWindow: 20971520

# Секции bandwidth тут намеренно нет: отсутствие = без ограничения скорости.
# Написать "up: 0" нельзя — бинарник отвечает "bandwidth.up: invalid format",
# несмотря на то, что документация такой вариант разрешает.
ignoreClientBandwidth: false
disableUDP: false
EOF

  fix_perms
}

client_uri() {
  local name=$1
  # shellcheck disable=SC1090
  . "$ENV_FILE"

  local pass
  pass=$(awk -F'\t' -v n="$name" '$1==n{print $2; exit}' "$USERS_FILE")
  [[ -n $pass ]] || die "Клиент '$name' не найден. Смотри: $0 list"

  local host params
  if [[ $HY_MODE == acme ]]; then
    host=$HY_DOMAIN
    params="sni=$(urlencode "$HY_DOMAIN")"
  else
    host=$HY_IP
    params="sni=$(urlencode "$HY_SNI")&insecure=1&pinSHA256=$(urlencode "$HY_PIN")"
  fi

  if [[ -n ${HY_OBFS_PASS:-} ]]; then
    params+="&obfs=salamander&obfs-password=$(urlencode "$HY_OBFS_PASS")"
  fi

  printf 'hy2://%s:%s@%s:%s/?%s#%s' \
    "$(urlencode "$name")" "$(urlencode "$pass")" "$host" "$HY_PORT" "$params" "$(urlencode "$name")"
}

client_yaml() {
  local name=$1
  # shellcheck disable=SC1090
  . "$ENV_FILE"

  local pass
  pass=$(awk -F'\t' -v n="$name" '$1==n{print $2; exit}' "$USERS_FILE")

  local server tls_lines
  if [[ $HY_MODE == acme ]]; then
    server="$HY_DOMAIN:$HY_PORT"
    tls_lines="tls:
  sni: $HY_DOMAIN"
  else
    server="$HY_IP:$HY_PORT"
    tls_lines="tls:
  sni: $HY_SNI
  insecure: true
  pinSHA256: $HY_PIN"
  fi

  local obfs_lines=''
  if [[ -n ${HY_OBFS_PASS:-} ]]; then
    obfs_lines="
obfs:
  type: salamander
  salamander:
    password: $HY_OBFS_PASS
"
  fi

  cat <<EOF
server: $server

auth: $name:$pass
$obfs_lines
$tls_lines

# Локальные порты на устройстве. Приложения с TUN-режимом их обычно не используют.
socks5:
  listen: 127.0.0.1:1080
http:
  listen: 127.0.0.1:8080

# Раскомментируй, только если точно знаешь скорость своего канала.
# С этими значениями Hysteria переходит на Brutal congestion control и жмёт
# ровно столько, сколько тут написано — завысишь, и получишь потери вместо скорости.
# Пока закомментировано, работает адаптивный BBR, и это правильный выбор по умолчанию.
# bandwidth:
#   up: 20 mbps
#   down: 100 mbps
EOF
}

emit_client() {
  local name=$1 uri
  uri=$(client_uri "$name")

  mkdir -p "$CLIENT_DIR"
  chmod 700 "$CLIENT_DIR"
  client_yaml "$name" > "$CLIENT_DIR/$name.yaml"
  printf '%s\n' "$uri" > "$CLIENT_DIR/$name.txt"
  chmod 600 "$CLIENT_DIR/$name.yaml" "$CLIENT_DIR/$name.txt"

  echo
  log "Клиент: $name"
  echo
  echo "$uri"
  echo
  if command -v qrencode >/dev/null 2>&1; then
    qrencode -t ANSIUTF8 -m 1 "$uri"
    qrencode -o "$CLIENT_DIR/$name.png" -s 8 -m 2 "$uri" 2>/dev/null || true
    chmod 600 "$CLIENT_DIR/$name.png" 2>/dev/null || true
    echo
    echo "QR-код картинкой: $CLIENT_DIR/$name.png"
  else
    warn "qrencode не установлен — QR-код не нарисован, копируй ссылку выше."
  fi
  echo "YAML-конфиг:      $CLIENT_DIR/$name.yaml"
  echo "Ссылка текстом:   $CLIENT_DIR/$name.txt"
  echo
}

restart_server() {
  systemctl enable hysteria-server.service >/dev/null 2>&1 || true
  systemctl restart hysteria-server.service
  sleep 2
  if ! systemctl is-active --quiet hysteria-server.service; then
    warn "Сервис не поднялся. Логи:"
    # -o cat без префиксов: иначе длинная JSON-ошибка уезжает за край экрана.
    journalctl -u hysteria-server.service -n 25 --no-pager -o cat || true
    echo >&2
    warn "Права на /etc/hysteria (сервис работает от '$(svc_user)'):"
    ls -la "$CONF_DIR" >&2 || true
    die "hysteria-server не запустился — смотри вывод выше."
  fi
}

# ---------------------------------------------------------------- install ----

cmd_install() {
  need_root install
  check_os

  local domain='' email='' sni='www.bing.com' port=443 ip=''
  local masq_url='https://www.bing.com/' obfs=1 bbr=1 client_name='incy'

  while [[ $# -gt 0 ]]; do
    case $1 in
      --domain)      domain=${2:?}; shift 2 ;;
      --email)       email=${2:?}; shift 2 ;;
      --sni)         sni=${2:?}; shift 2 ;;
      --port)        port=${2:?}; shift 2 ;;
      --ip)          ip=${2:?}; shift 2 ;;
      --masquerade)  masq_url=${2:?}; shift 2 ;;
      --client)      client_name=${2:?}; shift 2 ;;
      --no-obfs)     obfs=0; shift ;;
      --no-bbr)      bbr=0; shift ;;
      *) die "Неизвестный флаг: $1" ;;
    esac
  done

  [[ $port =~ ^[0-9]+$ && $port -ge 1 && $port -le 65535 ]] || die "Плохой порт: $port"

  # Ловим placeholder'ы вида vpn.твой.com, скопированные из инструкции как есть.
  if [[ -n $domain ]]; then
    [[ $domain =~ ^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$ ]] \
      || die "'$domain' не похож на домен. Подставь свой настоящий, а не пример из инструкции."
    [[ $domain =~ (твой|example|yourdomain|домен) ]] \
      && die "'$domain' — это заглушка из инструкции. Нужен твой реальный домен, или ставь без --domain."
  fi
  if [[ -n $email && ! $email =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]]; then
    die "'$email' не похож на почту. Подставь свою настоящую."
  fi
  client_name=$(sanitize_name "$client_name")

  log "Ставлю зависимости"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq curl openssl qrencode ca-certificates >/dev/null

  [[ -n $ip ]] || ip=$(detect_ip)
  log "Внешний IP: $ip"

  local mode
  if [[ -n $domain ]]; then
    mode=acme
    [[ -n $email ]] || email="admin@$domain"
    log "Режим: ACME, домен $domain (сертификат Let's Encrypt)"

    local resolved
    resolved=$(getent ahostsv4 "$domain" 2>/dev/null | awk 'NR==1{print $1}') || true
    if [[ -z $resolved ]]; then
      warn "Домен $domain не резолвится. Проверь A-запись, иначе Let's Encrypt не выдаст сертификат."
    elif [[ $resolved != "$ip" ]]; then
      warn "A-запись $domain ведёт на $resolved, а сервер — $ip. Сертификат не выпустится, пока не совпадёт."
    fi

    if port_is_busy 80 tcp; then
      warn "TCP/80 занят — Let's Encrypt проверяет домен именно там. Освободи порт (например, останови nginx) и запусти снова."
    fi
  else
    mode=selfsigned
    log "Режим: самоподписанный сертификат, SNI $sni (домен не нужен)"
  fi

  if port_is_busy "$port" udp; then
    warn "UDP/$port уже кем-то занят. Если это старый hysteria — ок, перезапишу."
  fi

  log "Ставлю Hysteria 2"
  local inst_log=/var/log/hysteria-install.log
  if ! bash <(curl -fsSL https://get.hy2.sh/) >"$inst_log" 2>&1; then
    tail -n 20 "$inst_log" >&2 || true
    die "Официальный установщик Hysteria не отработал, лог целиком: $inst_log"
  fi
  command -v hysteria >/dev/null 2>&1 || die "Бинарник hysteria не появился в PATH, лог: $inst_log"

  # hysteria version печатает многострочную простыню, первая строка бывает пустой.
  local ver
  ver=$(hysteria version 2>&1 | grep -iom1 'v[0-9][0-9.]*' || true)
  log "Версия: ${ver:-не определилась (не страшно, бинарник на месте)}"

  HY_SVC_USER=$(svc_user)
  if [[ $HY_SVC_USER == root ]]; then
    warn "Системный пользователь hysteria не создан — сервис пойдёт от root."
  fi


  mkdir -p "$CONF_DIR"

  if [[ $mode == selfsigned ]]; then
    log "Генерю самоподписанный сертификат на CN=$sni"
    openssl req -x509 -nodes -days 3650 \
      -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 \
      -keyout "$KEY" -out "$CERT" -subj "/CN=$sni" 2>/dev/null
    HY_SVC_USER=$(svc_user)
  fi

  local pin=''
  if [[ $mode == selfsigned ]]; then
    pin=$(openssl x509 -noout -fingerprint -sha256 -in "$CERT" | sed 's/.*Fingerprint=//; s/.*=//')
  fi

  local obfs_pass=''
  if [[ $obfs -eq 1 ]]; then obfs_pass=$(rand_str 20); fi

  umask 077
  cat > "$ENV_FILE" <<EOF
HY_MODE=$mode
HY_PORT=$port
HY_IP=$ip
HY_DOMAIN=${domain:-}
HY_EMAIL=${email:-}
HY_SNI=$sni
HY_PIN=$pin
HY_OBFS_PASS=$obfs_pass
HY_MASQ_URL=$masq_url
HY_SVC_USER=$HY_SVC_USER
EOF
  chmod 600 "$ENV_FILE"

  printf '%s\t%s\n' "$client_name" "$(rand_str 24)" > "$USERS_FILE"
  chmod 600 "$USERS_FILE"

  log "Собираю конфиг сервера"
  write_config

  log "Кручу сетевые параметры (буферы UDP$([[ $bbr -eq 1 ]] && echo ', BBR'))"
  cat > /etc/sysctl.d/99-hysteria.conf <<EOF
net.core.rmem_max=16777216
net.core.wmem_max=16777216
EOF
  if [[ $bbr -eq 1 ]]; then
    cat >> /etc/sysctl.d/99-hysteria.conf <<EOF
net.core.default_qdisc=fq
net.ipv4.tcp_congestion_control=bbr
EOF
  fi
  sysctl --system >/dev/null 2>&1 || warn "sysctl отработал с ошибкой — не критично, но буферы могут остаться дефолтными."

  if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q '^Status: active'; then
    log "Открываю порты в ufw"
    ufw allow "$port"/udp >/dev/null 2>&1 || true
    ufw allow "$port"/tcp >/dev/null 2>&1 || true   # masquerade по HTTPS, чтобы сервер выглядел живым сайтом
    [[ $mode == acme ]] && ufw allow 80/tcp >/dev/null 2>&1 || true
  else
    warn "ufw не активен. Если у провайдера свой фаервол (Hetzner, Oracle, AWS) — открой UDP/$port вручную в панели."
  fi

  log "Запускаю сервис"
  restart_server

  emit_client "$client_name"
  log "Готово. Сервер слушает UDP/$port."
  echo "Добавить ещё клиента: $0 add имя"
}

# ------------------------------------------------------------- управление ----

require_installed() {
  [[ -f $ENV_FILE && -f $USERS_FILE ]] || die "Hysteria не установлена этим скриптом. Сначала: $0 install"
}

cmd_add() {
  need_root add
  require_installed
  local name; name=$(sanitize_name "${1:?Укажи имя: $0 add имя}")
  if awk -F'\t' -v n="$name" '$1==n{found=1} END{exit !found}' "$USERS_FILE"; then
    die "Клиент '$name' уже есть. Покажу его: $0 show $name"
  fi
  printf '%s\t%s\n' "$name" "$(rand_str 24)" >> "$USERS_FILE"
  write_config
  restart_server
  emit_client "$name"
}

cmd_del() {
  need_root del
  require_installed
  local name; name=$(sanitize_name "${1:?Укажи имя: $0 del имя}")
  awk -F'\t' -v n="$name" '$1==n{found=1} END{exit !found}' "$USERS_FILE" \
    || die "Клиента '$name' нет"
  [[ $(wc -l < "$USERS_FILE") -gt 1 ]] \
    || die "Это последний клиент — Hysteria не стартует с пустым списком. Сначала добавь другого."
  local tmp; tmp=$(mktemp)
  awk -F'\t' -v n="$name" '$1!=n' "$USERS_FILE" > "$tmp"
  mv "$tmp" "$USERS_FILE"
  chmod 600 "$USERS_FILE"
  rm -f "$CLIENT_DIR/$name.yaml" "$CLIENT_DIR/$name.txt" "$CLIENT_DIR/$name.png"
  write_config
  restart_server
  log "Клиент '$name' удалён, доступ отозван."
}

cmd_list() {
  need_root list
  require_installed
  echo "Клиенты:"
  awk -F'\t' '{print "  - " $1}' "$USERS_FILE"
}

cmd_show() {
  need_root show
  require_installed
  local name; name=$(sanitize_name "${1:?Укажи имя: $0 show имя}")
  emit_client "$name"
  echo "--- YAML для клиентов, которые не понимают hy2://-ссылку ---"
  client_yaml "$name"
}

# Голая ссылка без единого лишнего символа — чтобы можно было скопировать
# мышкой или утащить через ssh ... key прямо в буфер.
cmd_key() {
  need_root key
  require_installed
  local name
  if [[ $# -gt 0 && -n ${1:-} ]]; then
    name=$(sanitize_name "$1")
  else
    name=$(awk -F'\t' 'NR==1{print $1}' "$USERS_FILE")
    [[ -n $name ]] || die "В $USERS_FILE нет клиентов"
  fi
  client_uri "$name"
  echo
}

# Спасательный круг для установки, которую уронила старая версия скрипта.
cmd_repair() {
  need_root repair
  require_installed
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  log "Пересобираю конфиг и раскладываю права заново"
  write_config
  fix_perms
  restart_server
  log "Сервис поднялся. Ключ:"
  cmd_key
}

cmd_status() {
  need_root status
  systemctl status hysteria-server.service --no-pager -l || true
  echo
  echo "Слушающие сокеты:"
  ss -lnup 2>/dev/null | grep -i hysteria || echo "  (hysteria не слушает — смотри логи: journalctl -u hysteria-server -n 50)"
}

cmd_uninstall() {
  need_root uninstall
  read -rp "Снести Hysteria 2 вместе с конфигами и ключами клиентов? [y/N] " a
  [[ ${a,,} == y ]] || { echo "Отменено."; exit 0; }
  systemctl disable --now hysteria-server.service >/dev/null 2>&1 || true
  bash <(curl -fsSL https://get.hy2.sh/) --remove >/dev/null 2>&1 || true
  rm -rf "$CONF_DIR" "$CLIENT_DIR" /etc/sysctl.d/99-hysteria.conf
  sysctl --system >/dev/null 2>&1 || true
  log "Удалено."
}

usage() {
  sed -n '3,16p' "$0" | sed 's/^# \{0,1\}//'
}

main() {
  local cmd=${1:-install}
  [[ $# -gt 0 ]] && shift || true
  case $cmd in
    install)        cmd_install "$@" ;;
    add|add-client) cmd_add "$@" ;;
    del|del-client|rm) cmd_del "$@" ;;
    list|list-clients) cmd_list ;;
    show)           cmd_show "$@" ;;
    key)            cmd_key "$@" ;;
    repair)         cmd_repair ;;
    status)         cmd_status ;;
    uninstall)      cmd_uninstall ;;
    -h|--help|help) usage ;;
    *) usage; die "Неизвестная команда: $cmd" ;;
  esac
}

main "$@"
