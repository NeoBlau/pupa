import { getLang, onLang, setLang, tr, type Lang } from "./i18n";
import { DiveMode } from "./modes/dive";
import { MapMode } from "./modes/map";
import { LabMode } from "./modes/lab";

type Mode = "dive" | "map" | "lab";

function applyTexts() {
  document.querySelectorAll<HTMLElement>("[data-t]").forEach((el) => {
    el.textContent = tr(el.dataset.t as Parameters<typeof tr>[0]);
  });
  document.querySelectorAll<HTMLButtonElement>("[data-lang]").forEach((b) => b.classList.toggle("active", b.dataset.lang === getLang()));
  document.title = tr("title");
}

const dive = new DiveMode();
const lab = new LabMode();
let started = false;

function setMode(m: Mode) {
  for (const id of ["dive", "map", "lab"] as Mode[]) {
    document.getElementById(`mode-${id}`)!.hidden = id !== m;
  }
  document.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((b) => {
    b.classList.toggle("active", b.dataset.mode === m);
    b.setAttribute("aria-selected", String(b.dataset.mode === m));
  });
  if (m === "dive") dive.show();
  if (m === "map") map.render();
  if (m === "lab") lab.update();
}

const map = new MapMode((setup) => {
  dive.start(setup);
  started = true;
  setMode("dive");
  window.scrollTo({ top: 0 });
});

document.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((b) =>
  b.addEventListener("click", () => {
    const m = b.dataset.mode as Mode;
    setMode(m === "dive" && !started ? "map" : m);
  }),
);

const setWarp = (w: number) => {
  dive.setWarp(w);
  document.querySelectorAll<HTMLButtonElement>("[data-warp]").forEach((b) => b.classList.toggle("active", +b.dataset.warp! === w));
};
document.querySelectorAll<HTMLButtonElement>("[data-warp]").forEach((b) => b.addEventListener("click", () => setWarp(+b.dataset.warp!)));
const pauseBtn = document.getElementById("pause")!;
const syncPause = () => (pauseBtn.textContent = dive.running ? tr("pause") : tr("resume"));
pauseBtn.addEventListener("click", () => { dive.togglePause(); syncPause(); });
// keyboard/gamepad actions that belong to the top bar arrive through the dive input
dive.onGlobalAction = (a) => {
  if (a === "warp1") setWarp(1);
  else if (a === "warp2") setWarp(10);
  else if (a === "warp3") setWarp(100);
  else if (a === "pause") { dive.togglePause(); syncPause(); }
};

// 3D model credits (licences require attribution)
fetch(`${import.meta.env.BASE_URL}models/credits.json`)
  .then((r) => r.json())
  .then((list: Array<{ credit: string; license: string; url: string }>) => {
    const ul = document.getElementById("credits")!;
    for (const c of list) {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.href = c.url; a.target = "_blank"; a.rel = "noopener"; a.textContent = c.credit;
      li.append(a, ` — ${c.license}`);
      ul.appendChild(li);
    }
    const li = document.createElement("li");
    li.textContent = "◇ Procedural (this project): jellyfish, manta, moray, anglerfish, lanternfish, snailfish, branching corals; submarine models and cockpits.";
    ul.appendChild(li);
  })
  .catch(() => {});

document.querySelectorAll<HTMLButtonElement>("[data-lang]").forEach((b) => b.addEventListener("click", () => setLang(b.dataset.lang as Lang)));
onLang(() => { applyTexts(); syncPause(); map.render(); lab.refreshLang(); dive.refreshLang(); });

document.documentElement.lang = getLang();
applyTexts();
syncPause();
setWarp(10);
setMode("map");

// Read-only handle for automated browser checks and power users (console).
(window as unknown as { oceanSim: unknown }).oceanSim = { dive };
