# Sole Spa — 3D foot spa & clinic simulator (web)

A free-play 3D game: an anatomical, soft-body foot you treat with real tools. Nothing is
scripted — blood runs until you stop it, foam stays until rinsed, wounds heal only when
they are clean and dressed. Optional "patients" give a checklist and a coin bonus.

Runs in any modern browser (desktop and mobile) and inside Telegram as a Mini App.

## Run it

Requirements: Node 22.18+.

```bash
cd webapp && npm install && npm run build      # builds into webapp/dist
cd ../server && ALLOW_DEV=1 npm start          # http://localhost:8080
```

`ALLOW_DEV=1` lets a normal browser play without Telegram (progress is stored per browser).
Never enable it in production. Without the server the webapp still runs (progress in
localStorage) — e.g. `npx vite preview` in `webapp/`.

For Telegram: create a bot in @BotFather, copy `server/.env.example` to `server/.env`,
set `BOT_TOKEN`, `PUBLIC_URL` (HTTPS), then `/newapp` in BotFather with the same URL.
Purchases use Telegram Stars (only inside Telegram).

## Controls

| | Touch / mouse | Gamepad (standard mapping) |
|---|---|---|
| Use tool | one finger / left button | **RT** (analog = force) or A |
| How hard | **Force** slider (pressure screens & pens use real pressure) | **RT depth** |
| Move tool | drag | left stick |
| Camera | two fingers / right button, wheel | right stick, LT / D-pad zoom, B reset |
| Switch tool | toolbar | LB / RB, X = variant |

Vibration (gamepad): tattoo machine buzz, needle resistance and pop, pain thuds, laser pulses.

### Force matters
- **Needle**: too soft only dimples the skin, firm goes in to a depth set by force, too hard hurts and the puncture bleeds when pulled.
- **Skin thickness**: the heel pad is tough (needs a hard, longer push, goes in shallower, bleeds less, takes tattoo ink poorly);
  the ball is medium; toes and the top of the foot are thin — easy to pierce, more painful, bleed more.
- **Tattoo**: light = faint line, firm = clean line, too hard = blowout, pinpoint bleeding, pain.
- **Cotton / gauze**: hold it *pressed* on a wound to clot it; lifting too early re-opens it.
- **Hands**: deeper massage dents; pressing around an abscess drains it, pressing on it hurts.

### The skin reacts
Toes clench on pain, wiggle when tickled, fan out during a massage; the foot flinches.
Blood pools on the wound, runs downhill in streams and stays until it is blotted, foamed with
peroxide and wiped; a cotton pad must be *held* to stop it.
Pressure areas (heel, ball, toe pads) flush pink with massage, warm water, tickling and pain,
then calm down; friction leaves local redness; ice cools it.

## Content & licences

- Foot base mesh: CC0 by byzmod3d ([opengameart](https://opengameart.org/content/human-foot-3d-model)),
  subdivided and fitted to reference photos (`webapp/public/models/base`).
- Sole skin: baked from a reference photo (`webapp/public/skin`).
- Surface textures + HDRI: Poly Haven, CC0 (`webapp/public/tex/LICENSE.md`).
- Everything else (tools, decals, sounds) is procedural.

### Replace with your own models
- **Photos for the model cards**: `webapp/public/models/<id>/cover1-3.*`, `g1-3.*`.
- **A 3D scan** (e.g. RealityScan, `.glb` with texture): put it in `public/models/<id>/foot.glb`
  and set `scan: 'models/<id>/foot.glb'` (+ `scanRotation` so toes point +Y, sole faces +Z)
  for that model in `shared/game.ts`.
- **A sole photo** for real skin detail: see the baking scripts referenced in `shared/game.ts`
  (`sole.albedo`, `sole.height`).

Make sure you hold a model release (commercial use) and 18+ proof for every person whose
photos or scans you use.

## Layout

```
shared/game.ts           economy, models, orders (shared by client & server)
server/src               Node HTTP server: Telegram auth, anti-cheat, Stars payments, bot
webapp/src/game          three.js engine, foot, paint layers, tools
webapp/src/game/sandbox  free-play world, tools, orders
webapp/src/screens       UI
```
