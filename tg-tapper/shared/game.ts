// Shared game rules. Imported by both the webapp (optimistic updates) and the
// server (authoritative). Keep this file free of enums / namespaces so Node can
// run it with plain type stripping.

export type ItemId = 'gold' | 'music' | 'candle';
export type ToolId = 'oil' | 'wash' | 'tickle' | 'needles' | 'tattoo' | 'removal' | 'wound';
export type Currency = 'stars' | 'ton';

export interface ModelDef {
  id: string;
  name: string;
  /** Coins needed to unlock. 0 = available from the start. */
  unlockCost: number;
  /** Income multiplier at level 1. */
  baseMult: number;
  /**
   * Optional 3D scan of this model's foot (.glb with textures), e.g. models/anna/foot.glb.
   * Without it a procedural foot in the model's skin tone is used.
   */
  scan?: string;
  /** Euler rotation (radians) that turns the scan so toes point +Y and the sole faces +Z. */
  scanRotation?: [number, number, number];
  /** Skin tone of the procedural foot. */
  skin: string;
  /**
   * Real skin detail baked from a sole photo into the foot's UV space (see README):
   * `height` = creases & pores (used for relief), `albedo` = the photo's colour.
   */
  sole?: { albedo?: string; height: string; outline?: string };
  /** Acupuncture points on the foot in metres (foot space). Random sole points if omitted. */
  acupoints?: [number, number, number][];
  /** Photos shown in the model card carousel. */
  cover: string[];
  /** Bonus gallery; photo i opens at level galleryLevels[i]. */
  gallery: string[];
  galleryLevels: number[];
}

const SOLE_HEIGHT = 'skin/sole_height.webp';

const m = (id: string, name: string, unlockCost: number, baseMult: number, skin: string, albedo?: string): ModelDef => ({
  id,
  name,
  unlockCost,
  baseMult,
  skin,
  sole: { albedo, height: SOLE_HEIGHT, outline: 'skin/sole_outline.json' },
  cover: [`models/${id}/cover1.svg`, `models/${id}/cover2.svg`, `models/${id}/cover3.svg`],
  gallery: [`models/${id}/g1.svg`, `models/${id}/g2.svg`, `models/${id}/g3.svg`],
  galleryLevels: [2, 5, 10],
});

// Cover/gallery .svg files are placeholders: replace them with your photos (see README).
export const MODELS: ModelDef[] = [
  m('anna', 'Anna', 0, 1, '#c18c6d', 'skin/sole_albedo.webp'),
  m('kate', 'Kate', 20_000, 1.5, '#f5cfb6'),
  m('kim', 'Kim', 50_000, 2.2, '#eec7a1'),
  m('tiffany', 'Tiffany', 50_000, 2.2, '#8e5a3b'),
  m('mia', 'Mia', 150_000, 3.5, '#e5b691'),
  m('lola', 'Lola', 400_000, 5, '#c88e6a'),
];

export const MAX_LEVEL = 10;

export interface StageDef {
  id: string;
  label: string;
  icon: string;
  /** Meter value (0..100) where this stage starts. */
  at: number;
  mult: number;
}

export const STAGES: StageDef[] = [
  { id: 'tease', label: 'TEASE', icon: '💋', at: 0, mult: 1 },
  { id: 'relaxed', label: 'RELAXED', icon: '😌', at: 25, mult: 1.5 },
  { id: 'enjoying', label: 'ENJOYING', icon: '😊', at: 55, mult: 2.2 },
  { id: 'bliss', label: 'BLISS', icon: '🥰', at: 85, mult: 3 },
];

export const METER = {
  /** Meter gained per work unit (see TOOLS). */
  perUnit: 1.6,
  decayPerSec: 4,
  idleBeforeDecaySec: 2,
  /** Meter value after reaching the top. */
  afterPeak: 10,
};

/** Coins per work unit at stage 1, model x1. */
export const BASE_UNIT = 2;
/** Bonus for filling the mood meter. */
export const PEAK_BONUS = 150;
export const MAX_UNITS_PER_SEC = 20;
/** Peaks + finished procedures; none of them can happen faster than this. */
export const MIN_COMBO_INTERVAL_MS = 1500;
/** Accuracy bonus a procedure can get (acupuncture timing, tattoo precision). */
export const MAX_PERFECT_MULT = 2;

export interface ToolDef {
  id: ToolId;
  /** spa = fills the mood meter; clinic = medical procedures with their own Healing meter. */
  kind: 'spa' | 'clinic';
  name: string;
  icon: string;
  hint: string;
  /** Model level needed to use the tool. */
  level: number;
  /** Coins for finishing the procedure (x model multiplier x accuracy). */
  bonus: number;
}

export const TOOLS: ToolDef[] = [
  { id: 'oil', kind: 'spa', name: 'Oil', icon: '🧴', hint: 'Pour, spread and massage', level: 1, bonus: 300 },
  { id: 'wash', kind: 'spa', name: 'Wash', icon: '🫧', hint: 'Wet, lather, rinse, towel dry', level: 1, bonus: 400 },
  { id: 'tickle', kind: 'spa', name: 'Tickle', icon: '🪶', hint: 'Fast strokes with the feather', level: 2, bonus: 350 },
  { id: 'wound', kind: 'clinic', name: 'Wound care', icon: '🩹', hint: 'Rinse, drain, disinfect, dress, heal', level: 1, bonus: 500 },
  { id: 'needles', kind: 'clinic', name: 'Acupuncture', icon: '📍', hint: 'Disinfect, insert, remove, aftercare', level: 3, bonus: 600 },
  { id: 'tattoo', kind: 'clinic', name: 'Tattoo', icon: '🖋️', hint: 'Stencil, lining, shading, aftercare', level: 5, bonus: 900 },
  { id: 'removal', kind: 'clinic', name: 'Laser removal', icon: '🔦', hint: 'Laser the ink, cool, dress, heal', level: 5, bonus: 800 },
];
export const toolById = (id: ToolId) => TOOLS.find((t) => t.id === id)!;

export interface ItemDef {
  id: ItemId;
  name: string;
  icon: string;
  desc: string;
  durationSec: number;
  coinMult: number;
  meterMult: number;
  /** Instant meter boost. */
  meterBoost: number;
  coinPrice: number;
}

export const ITEMS: Record<ItemId, ItemDef> = {
  gold: { id: 'gold', name: 'Golden Oil', icon: '✨', desc: 'x2 coins for 30s', durationSec: 30, coinMult: 2, meterMult: 1, meterBoost: 0, coinPrice: 1500 },
  music: { id: 'music', name: 'Relax Music', icon: '🎶', desc: 'x2 mood speed for 20s', durationSec: 20, coinMult: 1, meterMult: 2, meterBoost: 0, coinPrice: 2000 },
  candle: { id: 'candle', name: 'Aroma Candle', icon: '🕯️', desc: 'Instantly +35 mood', durationSec: 0, coinMult: 1, meterMult: 1, meterBoost: 35, coinPrice: 800 },
};
export const ITEM_IDS: ItemId[] = ['gold', 'music', 'candle'];

export interface Grant {
  coins?: number;
  items?: Partial<Record<ItemId, number>>;
  models?: string[];
}

export interface ProductDef {
  id: string;
  tab: 'coins' | 'consumables' | 'models';
  title: string;
  desc: string;
  icon: string;
  stars: number;
  ton: number;
  grant: Grant;
}

export const PRODUCTS: ProductDef[] = [
  { id: 'pack_s', tab: 'coins', title: 'First Touch', icon: '🪙', desc: '24,750 coins + 6 Candles, 3 Music, 3 Golden Oil', stars: 99, ton: 0.4, grant: { coins: 24_750, items: { candle: 6, music: 3, gold: 3 } } },
  { id: 'pack_m', tab: 'coins', title: 'Sole Master', icon: '💰', desc: '49,750 coins + 15 Candles, 8 Music, 8 Golden Oil', stars: 199, ton: 0.8, grant: { coins: 49_750, items: { candle: 15, music: 8, gold: 8 } } },
  { id: 'pack_l', tab: 'coins', title: 'God of Massage', icon: '👑', desc: '74,750 coins + 32 Candles, 18 Music, 18 Golden Oil', stars: 299, ton: 1.2, grant: { coins: 74_750, items: { candle: 32, music: 18, gold: 18 } } },
  { id: 'gold_10', tab: 'consumables', title: '10x Golden Oil', icon: '✨', desc: 'x2 coins for 30s each', stars: 49, ton: 0.2, grant: { items: { gold: 10 } } },
  { id: 'music_10', tab: 'consumables', title: '10x Relax Music', icon: '🎶', desc: 'x2 mood speed for 20s each', stars: 49, ton: 0.2, grant: { items: { music: 10 } } },
  { id: 'candle_20', tab: 'consumables', title: '20x Aroma Candle', icon: '🕯️', desc: 'Instant +35 mood', stars: 39, ton: 0.15, grant: { items: { candle: 20 } } },
  { id: 'model_mia', tab: 'models', title: 'Unlock Mia', icon: '🔥', desc: 'x3.5 income, skip the grind', stars: 249, ton: 1, grant: { models: ['mia'] } },
  { id: 'model_lola', tab: 'models', title: 'Unlock Lola', icon: '💎', desc: 'x5 income, skip the grind', stars: 499, ton: 2, grant: { models: ['lola'] } },
];

export const DAILY_REWARDS = [500, 1_000, 2_000, 3_500, 5_000, 7_500, 12_000];
export const REF_BONUS = { inviter: 5_000, invitee: 2_500 };

export interface TaskDef {
  id: string;
  title: string;
  reward: number;
  /** Telegram channel to join; verified on the server with getChatMember. */
  channel?: string;
  url: string;
}

export const TASKS: TaskDef[] = [
  { id: 'join_channel', title: 'Join our channel', reward: 3_000, channel: '@your_channel', url: 'https://t.me/your_channel' },
];

// ---------------------------------------------------------------------------
// Player state & pure rules

export interface PlayerState {
  coins: number;
  /** modelId -> level (absent = locked). */
  models: Record<string, number>;
  selected: string;
  items: Record<ItemId, number>;
  /** Epoch ms when each timed item expires. */
  boosts: Partial<Record<ItemId, number>>;
  daily: { lastDay: string | null; streak: number };
  tasks: string[];
  refCount: number;
  totalUnits: number;
}

export function newPlayer(): PlayerState {
  return {
    coins: 0,
    models: { anna: 1 },
    selected: 'anna',
    items: { gold: 2, music: 1, candle: 3 },
    boosts: {},
    daily: { lastDay: null, streak: 0 },
    tasks: [],
    refCount: 0,
    totalUnits: 0,
  };
}

export const modelById = (id: string) => MODELS.find((x) => x.id === id);

export function modelMult(def: ModelDef, level: number) {
  return def.baseMult * (1 + 0.25 * (level - 1));
}

export function upgradeCost(def: ModelDef, level: number) {
  return Math.round(Math.max(def.unlockCost, 6_000) * 0.4 * 1.55 ** (level - 1));
}

export function stageIndex(meter: number) {
  let i = 0;
  for (let k = 0; k < STAGES.length; k++) if (meter >= STAGES[k].at) i = k;
  return i;
}

export function isBoostActive(s: PlayerState, id: ItemId, now: number) {
  return (s.boosts[id] ?? 0) > now;
}

function boostCoinMult(s: PlayerState, now: number) {
  let mult = 1;
  for (const id of ITEM_IDS) if (isBoostActive(s, id, now)) mult *= ITEMS[id].coinMult;
  return mult;
}

export function currentModelMult(s: PlayerState) {
  const def = modelById(s.selected) ?? MODELS[0];
  return modelMult(def, s.models[def.id] ?? 1);
}

export function unitValue(s: PlayerState, stage: number, now: number) {
  return BASE_UNIT * currentModelMult(s) * STAGES[stage].mult * boostCoinMult(s, now);
}

export function peakValue(s: PlayerState, now: number) {
  return PEAK_BONUS * currentModelMult(s) * boostCoinMult(s, now);
}

/** `accuracy` is 0..1 and scales the bonus between x1 and x MAX_PERFECT_MULT. */
export function toolBonus(s: PlayerState, tool: ToolId, accuracy: number, now: number) {
  const acc = Math.min(Math.max(accuracy, 0), 1);
  return toolById(tool).bonus * currentModelMult(s) * boostCoinMult(s, now) * (1 + (MAX_PERFECT_MULT - 1) * acc);
}

export function isToolUnlocked(s: PlayerState, tool: ToolId) {
  return (s.models[s.selected] ?? 1) >= toolById(tool).level;
}

/** Upper bounds the server allows; boosts active at any point since `since` count. */
export function maxUnitValue(s: PlayerState, since: number) {
  return unitValue(s, STAGES.length - 1, since);
}

export function maxComboValue(s: PlayerState, since: number) {
  const best = Math.max(PEAK_BONUS, ...TOOLS.map((t) => t.bonus * MAX_PERFECT_MULT));
  return best * currentModelMult(s) * boostCoinMult(s, since);
}

export function nextLockedModel(s: PlayerState) {
  return MODELS.find((x) => !(x.id in s.models));
}

// Mutators return an error string or null on success. They mutate `s`.

export function unlockModel(s: PlayerState, id: string): string | null {
  const def = modelById(id);
  if (!def) return 'Unknown model';
  if (id in s.models) return 'Already unlocked';
  if (s.coins < def.unlockCost) return 'Not enough coins';
  s.coins -= def.unlockCost;
  s.models[id] = 1;
  s.selected = id;
  return null;
}

export function upgradeModel(s: PlayerState, id: string): string | null {
  const def = modelById(id);
  const level = s.models[id];
  if (!def || !level) return 'Model locked';
  if (level >= MAX_LEVEL) return 'Max level';
  const cost = upgradeCost(def, level);
  if (s.coins < cost) return 'Not enough coins';
  s.coins -= cost;
  s.models[id] = level + 1;
  return null;
}

export function selectModel(s: PlayerState, id: string): string | null {
  if (!(id in s.models)) return 'Model locked';
  s.selected = id;
  return null;
}

export function buyItem(s: PlayerState, id: ItemId): string | null {
  const def = ITEMS[id];
  if (!def) return 'Unknown item';
  if (s.coins < def.coinPrice) return 'Not enough coins';
  s.coins -= def.coinPrice;
  s.items[id] = (s.items[id] ?? 0) + 1;
  return null;
}

export function useItem(s: PlayerState, id: ItemId, now: number): string | null {
  const def = ITEMS[id];
  if (!def) return 'Unknown item';
  if ((s.items[id] ?? 0) <= 0) return `No ${def.name} left`;
  if (def.durationSec > 0 && isBoostActive(s, id, now)) return 'Already active';
  s.items[id] -= 1;
  if (def.durationSec > 0) s.boosts[id] = now + def.durationSec * 1000;
  return null;
}

export const utcDay = (now: number) => new Date(now).toISOString().slice(0, 10);

export function dailyStatus(s: PlayerState, now: number) {
  const today = utcDay(now);
  const yesterday = utcDay(now - 86_400_000);
  const claimedToday = s.daily.lastDay === today;
  const continues = s.daily.lastDay === yesterday || claimedToday;
  const streak = continues ? s.daily.streak : 0;
  // Index of the reward that the next claim gives (or the one claimed today).
  const index = claimedToday ? (streak - 1) % DAILY_REWARDS.length : streak % DAILY_REWARDS.length;
  return { claimedToday, streak, index };
}

export function claimDaily(s: PlayerState, now: number): string | null {
  const st = dailyStatus(s, now);
  if (st.claimedToday) return 'Already claimed today';
  s.coins += DAILY_REWARDS[st.index];
  s.daily = { lastDay: utcDay(now), streak: st.streak + 1 };
  return null;
}

export function applyGrant(s: PlayerState, g: Grant) {
  s.coins += g.coins ?? 0;
  for (const [id, n] of Object.entries(g.items ?? {})) s.items[id as ItemId] = (s.items[id as ItemId] ?? 0) + (n ?? 0);
  for (const id of g.models ?? []) if (!(id in s.models) && modelById(id)) s.models[id] = 1;
}

export interface WorkBatch {
  /** Work units done (rubbing, lathering, tickling, needles, tracing). */
  units: number;
  /** Mood peaks + finished procedures. */
  combos: number;
  coins: number;
}

/**
 * Server-side validation of a batch of work reported by the client.
 * Returns how many coins / units are accepted given the time since last sync.
 */
export function clampBatch(s: PlayerState, b: WorkBatch, lastSyncAt: number, now: number) {
  const elapsedSec = Math.min(Math.max((now - lastSyncAt) / 1000, 0), 60) + 1.5; // grace for latency
  const units = Math.max(0, Math.min(Math.floor(b.units) || 0, Math.ceil(elapsedSec * MAX_UNITS_PER_SEC)));
  const combos = Math.max(0, Math.min(Math.floor(b.combos) || 0, Math.ceil((elapsedSec * 1000) / MIN_COMBO_INTERVAL_MS)));
  const cap = units * maxUnitValue(s, lastSyncAt) + combos * maxComboValue(s, lastSyncAt);
  const coins = Math.max(0, Math.min(Math.floor(b.coins) || 0, Math.floor(cap)));
  return { units, combos, coins };
}
