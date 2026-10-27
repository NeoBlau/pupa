import { createHmac, timingSafeEqual } from 'node:crypto';

export interface TgUser {
  id: number;
  username?: string;
  first_name?: string;
}

export interface InitData {
  user: TgUser;
  startParam?: string;
}

/** Validates Telegram Mini App initData (https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app). */
export function validateInitData(raw: string, botToken: string, maxAgeSec = 86_400): InitData | null {
  const params = new URLSearchParams(raw);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');
  const checkString = [...params.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = createHmac('sha256', secret).update(checkString).digest();
  const given = Buffer.from(hash, 'hex');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  const authDate = Number(params.get('auth_date'));
  if (!authDate || Date.now() / 1000 - authDate > maxAgeSec) return null;

  const userJson = params.get('user');
  if (!userJson) return null;
  const user = JSON.parse(userJson) as TgUser;
  return { user, startParam: params.get('start_param') ?? undefined };
}

export function createBotApi(token: string) {
  const call = async <T = unknown>(method: string, body: Record<string, unknown> = {}): Promise<T> => {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as { ok: boolean; result: T; description?: string };
    if (!json.ok) throw new Error(`${method}: ${json.description}`);
    return json.result;
  };
  return { call };
}

export type BotApi = ReturnType<typeof createBotApi>;
