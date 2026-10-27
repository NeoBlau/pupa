import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  PRODUCTS,
  REF_BONUS,
  TASKS,
  applyGrant,
  buyItem,
  claimDaily,
  clampBatch,
  newPlayer,
  selectModel,
  unlockModel,
  upgradeModel,
  useItem,
  type ItemId,
  type PlayerState,
} from '../../shared/game.ts';
import { openDb, type UserRow } from './db.ts';
import { createBotApi, validateInitData, type TgUser } from './telegram.ts';

if (existsSync('.env')) process.loadEnvFile('.env');

const BOT_TOKEN = process.env.BOT_TOKEN ?? '';
const PUBLIC_URL = (process.env.PUBLIC_URL ?? '').replace(/\/$/, '');
const APP_SHORT_NAME = process.env.APP_SHORT_NAME ?? '';
const PORT = Number(process.env.PORT ?? 8080);
const ALLOW_DEV = process.env.ALLOW_DEV === '1';
const STATIC_DIR = resolve(import.meta.dirname, '../../webapp/dist');
const WEBHOOK_SECRET = randomBytes(24).toString('hex');

if (!BOT_TOKEN && !ALLOW_DEV) {
  console.error('BOT_TOKEN is required (or set ALLOW_DEV=1 for local testing).');
  process.exit(1);
}

const db = openDb(process.env.DB_PATH ?? './data/game.db');
const bot = BOT_TOKEN ? createBotApi(BOT_TOKEN) : null;
let botUsername = '';

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// Auth

function authenticate(req: IncomingMessage): { user: TgUser; startParam?: string } {
  const header = req.headers.authorization ?? '';
  if (!header.startsWith('tma ')) throw new HttpError(401, 'Missing auth');
  const raw = header.slice(4);
  if (ALLOW_DEV && raw.startsWith('dev:')) return { user: { id: Number(raw.slice(4)) || 1, username: 'dev' } };
  const data = BOT_TOKEN ? validateInitData(raw, BOT_TOKEN) : null;
  if (!data) throw new HttpError(401, 'Invalid initData');
  return data;
}

function loadOrCreate(user: TgUser, startParam: string | undefined): UserRow {
  const existing = db.get(user.id);
  if (existing) return existing;
  const now = Date.now();
  const state = newPlayer();
  let refBy: number | null = null;
  const refId = Number(startParam?.match(/^ref_(\d+)$/)?.[1]);
  if (refId && refId !== user.id) {
    const inviter = db.get(refId);
    if (inviter) {
      refBy = refId;
      inviter.state.coins += REF_BONUS.inviter;
      inviter.state.refCount += 1;
      db.save(inviter);
      state.coins += REF_BONUS.invitee;
    }
  }
  return db.create(user.id, user.username, state, refBy, now);
}

// ---------------------------------------------------------------------------
// HTTP helpers

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 64_000) throw new HttpError(413, 'Body too large');
    chunks.push(c);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'Bad JSON');
  }
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

const stateResponse = (s: PlayerState) => ({ state: s, now: Date.now() });

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
};

function serveStatic(req: IncomingMessage, res: ServerResponse) {
  const urlPath = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
  let file = normalize(join(STATIC_DIR, urlPath));
  if (!file.startsWith(STATIC_DIR)) return send(res, 403, { error: 'Forbidden' });
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(STATIC_DIR, 'index.html');
  if (!existsSync(file)) return send(res, 404, { error: 'Build the webapp first: npm run build' });
  const isAsset = file.includes(`${STATIC_DIR}/assets/`);
  res.writeHead(200, {
    'content-type': MIME[extname(file)] ?? 'application/octet-stream',
    'cache-control': isAsset ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  res.end(readFileSync(file));
}

// ---------------------------------------------------------------------------
// API

type Action = (s: PlayerState, id: string, now: number) => string | null;
const ACTIONS: Record<string, Action> = {
  unlock: (s, id) => unlockModel(s, id),
  upgrade: (s, id) => upgradeModel(s, id),
  select: (s, id) => selectModel(s, id),
  buyItem: (s, id) => buyItem(s, id as ItemId),
  useItem: (s, id, now) => useItem(s, id as ItemId, now),
  claimDaily: (s, _id, now) => claimDaily(s, now),
};

async function handleApi(req: IncomingMessage, res: ServerResponse, path: string) {
  const auth = authenticate(req);
  const body = req.method === 'POST' ? await readJson(req) : {};
  const now = Date.now();
  const u = loadOrCreate(auth.user, auth.startParam);

  if (path === '/api/state') {
    return send(res, 200, { ...stateResponse(u.state), botUsername, appShortName: APP_SHORT_NAME, userId: u.id });
  }

  if (path === '/api/work') {
    const ok = clampBatch(u.state, { units: Number(body.units), combos: Number(body.combos), coins: Number(body.coins) }, u.lastSyncAt, now);
    u.state.coins += ok.coins;
    u.state.totalUnits += ok.units;
    u.lastSyncAt = now;
    db.save(u);
    return send(res, 200, { ...stateResponse(u.state), accepted: ok });
  }

  if (path === '/api/action') {
    const fn = ACTIONS[String(body.type)];
    if (!fn) throw new HttpError(400, 'Unknown action');
    const err = fn(u.state, String(body.id ?? ''), now);
    if (err) throw new HttpError(400, err);
    db.save(u);
    return send(res, 200, stateResponse(u.state));
  }

  if (path === '/api/invoice') {
    const product = PRODUCTS.find((p) => p.id === body.productId);
    if (!product) throw new HttpError(400, 'Unknown product');
    if (!bot) throw new HttpError(503, 'Payments need BOT_TOKEN');
    // Telegram Stars: currency XTR, empty provider_token, exactly one price.
    const link = await bot.call<string>('createInvoiceLink', {
      title: product.title,
      description: product.desc,
      payload: JSON.stringify({ u: u.id, p: product.id }),
      provider_token: '',
      currency: 'XTR',
      prices: [{ label: product.title, amount: product.stars }],
    });
    return send(res, 200, { link });
  }

  if (path === '/api/task') {
    const task = TASKS.find((t) => t.id === body.id);
    if (!task) throw new HttpError(400, 'Unknown task');
    if (u.state.tasks.includes(task.id)) throw new HttpError(400, 'Already done');
    if (task.channel && bot) {
      // The bot must be an admin of the channel for getChatMember to work.
      const member = await bot.call<{ status: string }>('getChatMember', { chat_id: task.channel, user_id: u.id }).catch(() => null);
      if (!member || ['left', 'kicked'].includes(member.status)) throw new HttpError(400, 'Join the channel first');
    }
    u.state.tasks.push(task.id);
    u.state.coins += task.reward;
    db.save(u);
    return send(res, 200, stateResponse(u.state));
  }

  throw new HttpError(404, 'Not found');
}

// ---------------------------------------------------------------------------
// Bot updates (webhook or long polling)

interface Update {
  update_id: number;
  message?: {
    chat: { id: number };
    from?: TgUser;
    text?: string;
    successful_payment?: { currency: string; total_amount: number; invoice_payload: string; telegram_payment_charge_id: string };
  };
  pre_checkout_query?: { id: string; from: TgUser; invoice_payload: string; total_amount: number };
}

function parsePayload(raw: string) {
  try {
    const p = JSON.parse(raw) as { u: number; p: string };
    const product = PRODUCTS.find((x) => x.id === p.p);
    return product ? { userId: p.u, product } : null;
  } catch {
    return null;
  }
}

async function handleUpdate(up: Update) {
  if (!bot) return;
  const pcq = up.pre_checkout_query;
  if (pcq) {
    const p = parsePayload(pcq.invoice_payload);
    const ok = !!p && p.userId === pcq.from.id && p.product.stars === pcq.total_amount;
    await bot.call('answerPreCheckoutQuery', ok ? { pre_checkout_query_id: pcq.id, ok } : { pre_checkout_query_id: pcq.id, ok, error_message: 'Product unavailable' });
    return;
  }

  const msg = up.message;
  if (!msg) return;

  if (msg.successful_payment) {
    const sp = msg.successful_payment;
    const p = parsePayload(sp.invoice_payload);
    if (!p || !msg.from) return;
    db.tx(() => {
      if (!db.recordPayment(sp.telegram_payment_charge_id, msg.from!.id, p.product.id, sp.total_amount, sp.currency)) return;
      const u = loadOrCreate(msg.from!, undefined);
      applyGrant(u.state, p.product.grant);
      db.save(u);
    });
    await bot.call('sendMessage', { chat_id: msg.chat.id, text: `✅ ${p.product.title} added to your account. Have fun!` });
    return;
  }

  if (msg.text?.startsWith('/start')) {
    await bot.call('sendMessage', {
      chat_id: msg.chat.id,
      text: '18+ only. Tap the button to start playing 👇',
      reply_markup: PUBLIC_URL ? { inline_keyboard: [[{ text: '▶️ Play', web_app: { url: PUBLIC_URL } }]] } : undefined,
    });
  } else if (msg.text?.startsWith('/paysupport')) {
    // Required by Telegram for bots that sell digital goods with Stars.
    await bot.call('sendMessage', { chat_id: msg.chat.id, text: 'Payment issue? Describe it in one message and include the date of purchase. We reply within 24h.' });
  }
}

async function setupBot() {
  if (!bot) return;
  const me = await bot.call<{ username: string }>('getMe');
  botUsername = me.username;
  if (PUBLIC_URL) {
    await bot.call('setChatMenuButton', { menu_button: { type: 'web_app', text: 'Play', web_app: { url: PUBLIC_URL } } });
    await bot.call('setWebhook', {
      url: `${PUBLIC_URL}/bot/webhook`,
      secret_token: WEBHOOK_SECRET,
      allowed_updates: ['message', 'pre_checkout_query'],
    });
    console.log(`Bot @${botUsername}: webhook set to ${PUBLIC_URL}/bot/webhook`);
  } else {
    await bot.call('deleteWebhook');
    console.log(`Bot @${botUsername}: long polling (set PUBLIC_URL for webhook mode)`);
    void poll();
  }
}

async function poll() {
  let offset = 0;
  for (;;) {
    try {
      const updates = await bot!.call<Update[]>('getUpdates', { offset, timeout: 30, allowed_updates: ['message', 'pre_checkout_query'] });
      for (const up of updates) {
        offset = up.update_id + 1;
        await handleUpdate(up).catch((e) => console.error('update failed', e));
      }
    } catch (e) {
      console.error('polling error', e);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

// ---------------------------------------------------------------------------

createServer(async (req, res) => {
  const path = new URL(req.url ?? '/', 'http://x').pathname;
  try {
    if (path === '/bot/webhook' && req.method === 'POST') {
      if (req.headers['x-telegram-bot-api-secret-token'] !== WEBHOOK_SECRET) throw new HttpError(403, 'Bad secret');
      const up = (await readJson(req)) as unknown as Update;
      send(res, 200, { ok: true });
      await handleUpdate(up).catch((e) => console.error('update failed', e));
      return;
    }
    if (path.startsWith('/api/')) return await handleApi(req, res, path);
    serveStatic(req, res);
  } catch (e) {
    if (e instanceof HttpError) return send(res, e.status, { error: e.message });
    console.error(e);
    send(res, 500, { error: 'Internal error' });
  }
}).listen(PORT, () => {
  console.log(`Server on http://localhost:${PORT}`);
  setupBot().catch((e) => console.error('Bot setup failed:', e.message));
});
