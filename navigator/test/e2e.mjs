/* e2e.mjs — drives the real app in headless Chromium.
 *
 *   node serve.mjs 8099 &
 *   node test/e2e.mjs
 *
 * Needs Playwright plus a Chromium build. With a global install:
 *   PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs PW_CHROMIUM=/path/to/chrome node test/e2e.mjs
 * Every external host is stubbed, so this proves the offline paths specifically:
 * the app has to boot, route, search and navigate with nothing reachable.
 */
/* Resolve Playwright from the project, or from PLAYWRIGHT_MODULE when it is
   installed globally (ESM ignores NODE_PATH). */
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=','base64');
const errors = [], warnings = [];

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM || undefined,
  args: ['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'],
});
const ctx = await browser.newContext({
  viewport: { width: 414, height: 896 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  permissions: ['geolocation'], geolocation: { latitude: 55.7558, longitude: 37.6173, accuracy: 8 },
  locale: 'ru-RU',
});

// every external host is unreachable in this container; answer instantly instead of timing out
await ctx.route('**://*/**', async (route) => {
  const url = route.request().url();
  if (url.startsWith('http://localhost')) return route.continue();
  if (/\.png|\.pbf|\.jpg/.test(url)) return route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
  return route.fulfill({ status: 503, body: '{}' , contentType: 'application/json' });
});

const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  // every external host is stubbed here, so a failed load is the point, not a bug
  const text = m.text();
  const expected = text.includes('ERR_FAILED') || text.includes('ERR_ABORTED') || text.includes('Failed to load resource');
  if (m.type() === 'error' && !expected) errors.push(`console: ${text}`);
  if (m.type() === 'warning') warnings.push(text);
});

await page.goto(process.env.APP_URL || 'http://localhost:8099/index.html', { waitUntil: 'load' });
await page.waitForSelector('body[data-ready="true"]', { timeout: 20000 });
console.log('BOOT: ok');

const present = await page.evaluate(() => ({
  topbar: !!document.querySelector('.topbar'),
  sheet: !!document.querySelector('.sheet'),
  controls: document.querySelectorAll('.controls .fab').length,
  hud: !!document.querySelector('.hud'),
  searchField: !!document.querySelector('.search-field input'),
  profiles: document.querySelectorAll('.segmented button').length,
  mapCanvas: !!document.querySelector('#map canvas'),
  theme: document.documentElement.dataset.theme,
  pills: document.querySelectorAll('.topbar .pill').length,
}));
console.log('DOM:', JSON.stringify(present));

// --- geolocation reached the store
await page.waitForFunction(() => !!window.compass?.store?.coords, { timeout: 10000 });
console.log('GEO: position in store ->', await page.evaluate(() => window.compass.store.coords.map(v=>v.toFixed(4)).join(',')));

// --- sheet detents
await page.click('.sheet-grip');
await page.waitForTimeout(500);
console.log('SHEET detent after tap:', await page.getAttribute('.sheet', 'data-detent'));

// --- panel navigation
await page.click('.topbar .pill:last-child');           // settings
await page.waitForTimeout(400);
console.log('SETTINGS panel:', await page.evaluate(() => window.compass.app.sheet.current?.id),
            '| switches:', await page.locator('.switch').count());
await page.click('.sheet-body .btn.small');             // back
await page.waitForTimeout(300);

await page.evaluate(() => window.compass.app.showTrails());
await page.waitForTimeout(600);
console.log('TRAILS panel:', await page.evaluate(() => window.compass.app.sheet.current?.id),
            '| famous routes:', await page.locator('.sheet-body .row').count());
await page.evaluate(() => window.compass.app.sheet.pop());

await page.evaluate(() => window.compass.app.showOffline());
await page.waitForTimeout(700);
console.log('OFFLINE panel:', await page.evaluate(() => window.compass.app.sheet.current?.id),
            '| presets:', await page.locator('.sheet-body .list-card .row').count(),
            '| estimate shown:', await page.locator('.region-card').first().innerText().then(t=>t.split('\n')[1]?.slice(0,60)));
await page.evaluate(() => window.compass.app.sheet.pop());

// --- offline routing end to end, with a synthetic downloaded region
const routing = await page.evaluate(async () => {
  const { buildGraph, serializeGraph } = await import('./js/routing/graph.js');
  const { idb } = await import('./js/lib/idb.js');
  const N=20, step=0.002, lon0=37.56, lat0=55.71;
  const nodes=new Map(), ways=[]; const nid=(i,j)=>i*1000+j+1;
  for(let i=0;i<N;i++)for(let j=0;j<N;j++)nodes.set(nid(i,j),[lon0+j*step,lat0+i*step]);
  let w=1;
  for(let i=0;i<N;i++)ways.push({id:w++,nodes:Array.from({length:N},(_,j)=>nid(i,j)),tags:{highway:'residential',name:`Улица ${i}`,maxspeed:'40'}});
  for(let j=0;j<N;j++)ways.push({id:w++,nodes:Array.from({length:N},(_,i)=>nid(i,j)),tags:{highway:'secondary',name:`Проспект ${j}`,maxspeed:'60'}});
  const g=buildGraph({nodes,ways});
  const bbox=[lon0-0.01,lat0-0.01,lon0+N*step+0.01,lat0+N*step+0.01];
  await idb.put('regions',{id:'test',name:'Тестовый регион',bbox,detail:'city',styles:['day'],status:'ready',createdAt:Date.now(),counts:{edges:g.edgeFrom.length,cameras:2},bytes:1234});
  await idb.put('graph',{regionId:'test',data:serializeGraph(g),stats:{nodes:g.nodeLon.length,edges:g.edgeFrom.length}});
  await idb.putAll('cameras',[
    {id:'c1',coords:[lon0+5*step,lat0+3*step],cell:`${Math.floor((lon0+5*step)/0.01)}:${Math.floor((lat0+3*step)/0.01)}`,kind:'speed',maxspeed:60,direction:null,regionId:'test'},
    {id:'c2',coords:[lon0+12*step,lat0+9*step],cell:`${Math.floor((lon0+12*step)/0.01)}:${Math.floor((lat0+9*step)/0.01)}`,kind:'redLight',maxspeed:null,direction:null,regionId:'test'},
  ]);
  await idb.putAll('pois',[{id:'p1',coords:[lon0+10*step,lat0+10*step],cell:'x',regionId:'test',name:'Центральная площадь',kind:'city',rank:60,subtitle:'Тестовый город',tokens:['центральная','площадь']}]);

  const { invalidateGraphCache, planRoute, planAlternativesOffline } = await import('./js/routing/service.js');
  invalidateGraphCache();
  const from=[lon0+1*step,lat0+1*step], to=[lon0+17*step,lat0+16*step];
  const res = await planRoute([from,to], { profile:'car', preferOffline:true, avoid:{}, preference:'fastest' });
  const alts = await planAlternativesOffline([from,to], { profile:'car', avoid:{} });
  return {
    source: res.source,
    distance: Math.round(res.routes[0].distance),
    duration: Math.round(res.routes[0].duration),
    steps: res.routes[0].steps.length,
    firstStep: res.routes[0].steps[0] && (await import('./js/routing/maneuvers.js')).phraseFor(res.routes[0].steps[0],'ru'),
    summary: res.routes[0].summaryText,
    alternatives: alts.map(a=>({label:a.label, km:+(a.distance/1000).toFixed(2)})),
  };
});
console.log('OFFLINE ROUTING:', JSON.stringify(routing));

// --- offline search against the stored POI
const searchRes = await page.evaluate(async () => {
  const { searchOffline } = await import('./js/features/search.js');
  return (await searchOffline('центральная', { near:[37.58,55.73] })).map(r=>r.name);
});
console.log('OFFLINE SEARCH "центральная" ->', JSON.stringify(searchRes));

// --- drive the route: start navigation and feed synthetic fixes
const nav = await page.evaluate(async () => {
  const { planRoute } = await import('./js/routing/service.js');
  const lon0=37.56, lat0=55.71, step=0.002;
  const res = await planRoute([[lon0+1*step,lat0+1*step],[lon0+17*step,lat0+16*step]], { profile:'car', preferOffline:true, avoid:{}, preference:'fastest' });
  const route = res.routes[0];
  window.compass.store.set({ routes:[route], activeRouteIndex:0, destination:{name:'Финиш',coords:route.coordinates.at(-1)}, routeSource:'offline' });
  window.compass.app.startNavigation();
  await new Promise(r=>setTimeout(r,200));

  const { engine } = window.compass;
  const out = [];
  const coords = route.coordinates;
  let t = Date.now();
  for (let i=0;i<coords.length;i+=Math.max(1,Math.floor(coords.length/25))) {
    const p = engine.update({ coords: coords[i], accuracy:6, speed:16.6, heading:null, at:(t+=3000) });
    if (p) out.push({ rem: Math.round(p.remaining), toMan: Math.round(p.distanceToManeuver), step: p.step?.name ?? '' });
  }
  const last = engine.update({ coords: coords.at(-1), accuracy:6, speed:0, heading:null, at:(t+=3000) });
  return {
    navigating: document.body.classList.contains('navigating'),
    banner: document.querySelector('.maneuver-distance')?.textContent,
    street: document.querySelector('.maneuver-street')?.textContent,
    eta: document.querySelector('.nav-bottom .nav-stat b')?.textContent,
    speedo: document.querySelector('.speedo b')?.textContent,
    ticks: out.length,
    monotonic: out.every((o,i)=> i===0 || o.rem <= out[i-1].rem),
    firstRem: out[0]?.rem, lastRem: out.at(-1)?.rem,
    arrived: last?.arrived,
  };
});
console.log('NAVIGATION:', JSON.stringify(nav));

await page.screenshot({ path: './test/screenshots/nav.png' }).catch(() => {});
await page.evaluate(() => window.compass.app.stopNavigation({silent:true}));
await page.waitForTimeout(400);
await page.screenshot({ path: './test/screenshots/home.png' }).catch(() => {});

// --- dark theme render
await page.evaluate(() => { window.compass.settings.set('theme','dark'); window.compass.app.applyTheme(); });
await page.waitForTimeout(600);
await page.evaluate(() => window.compass.app.showSettings());
await page.waitForTimeout(400);
await page.screenshot({ path: './test/screenshots/dark.png' }).catch(() => {});

// --- service worker
const sw = await page.evaluate(async () => {
  const reg = await navigator.serviceWorker.getRegistration();
  return { registered: !!reg, scope: reg?.scope, state: reg?.active?.state ?? reg?.installing?.state };
});
console.log('SERVICE WORKER:', JSON.stringify(sw));

console.log('\nERRORS:', errors.length);
for (const e of errors.slice(0,20)) console.log('  -', e.slice(0,200));
await browser.close();
process.exit(errors.length ? 1 : 0);
