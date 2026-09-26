/**
 * Unified input: keyboard, mouse and gamepad (standard mapping) feed one
 * command state; discrete actions are delivered as edge-triggered events.
 *
 * Gamepad (standard layout):
 *   left stick        surge (Y) / yaw (X)
 *   right stick       camera look / orbit
 *   RT / LT           vertical thrusters down / up
 *   A                 interact (scan the nearest organism)
 *   B                 drop the next weight set
 *   X                 lights
 *   Y                 switch camera (1st / 3rd person)
 *   LB / RB           variable ballast − / +
 *   D-pad up / down   depth hold / blow-vent surface tanks
 *   Start             pause
 *   View / Back       photo
 */
export type Action =
  | "camera" | "lights" | "interact" | "drop" | "emergency" | "photo" | "pause"
  | "depthHold" | "surfaceTanks" | "warp1" | "warp2" | "warp3";

export interface Command {
  surge: number; sway: number; heave: number; yaw: number;
  /** −1…1 per second, applied to the variable-ballast target. */
  ballast: number;
  lookX: number; lookY: number; zoom: number;
}

const DEAD = 0.15;
const dz = (v: number) => (Math.abs(v) < DEAD ? 0 : (v - Math.sign(v) * DEAD) / (1 - DEAD));

export class Input {
  readonly cmd: Command = { surge: 0, sway: 0, heave: 0, yaw: 0, ballast: 0, lookX: 0, lookY: 0, zoom: 0 };
  private keys = new Set<string>();
  private actions: Action[] = [];
  private prevButtons: boolean[] = [];
  private mouse = { dx: 0, dy: 0, wheel: 0, dragging: false };
  gamepadName: string | null = null;
  enabled = true;

  constructor(private surface: HTMLElement) {
    window.addEventListener("keydown", (e) => {
      if (!this.enabled || (e.target as HTMLElement).closest("input, select, textarea, dialog")) return;
      const k = e.code;
      if (!this.keys.has(k)) this.keyAction(k);
      this.keys.add(k);
      if (k.startsWith("Arrow") || k === "Space" || k === "PageUp" || k === "PageDown") e.preventDefault();
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("blur", () => this.keys.clear());
    surface.addEventListener("pointerdown", (e) => { this.mouse.dragging = true; surface.setPointerCapture(e.pointerId); });
    surface.addEventListener("pointerup", (e) => { this.mouse.dragging = false; surface.releasePointerCapture(e.pointerId); });
    surface.addEventListener("pointermove", (e) => { if (this.mouse.dragging) { this.mouse.dx += e.movementX; this.mouse.dy += e.movementY; } });
    surface.addEventListener("wheel", (e) => { this.mouse.wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
    surface.addEventListener("dblclick", () => this.actions.push("camera"));
    window.addEventListener("gamepadconnected", (e) => (this.gamepadName = (e as GamepadEvent).gamepad.id));
    window.addEventListener("gamepaddisconnected", () => (this.gamepadName = null));
  }

  private keyAction(k: string) {
    const map: Record<string, Action> = {
      KeyC: "camera", KeyL: "lights", KeyE: "interact", KeyB: "drop", KeyX: "emergency",
      KeyP: "photo", Space: "pause", KeyH: "depthHold", KeyT: "surfaceTanks",
      Digit1: "warp1", Digit2: "warp2", Digit3: "warp3",
    };
    if (map[k]) this.actions.push(map[k]);
  }

  /** Push an action from on-screen buttons. */
  trigger(a: Action) { this.actions.push(a); }

  drainActions(): Action[] {
    const a = this.actions;
    this.actions = [];
    return a;
  }

  private gamepad(): Gamepad | null {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) if (p && p.connected) return p;
    return null;
  }

  /** Poll devices once per frame. */
  update() {
    const k = (c: string) => (this.keys.has(c) ? 1 : 0);
    const c = this.cmd;
    // keyboard
    c.surge = k("ArrowUp") - k("ArrowDown");
    c.yaw = k("ArrowLeft") - k("ArrowRight");
    c.sway = k("KeyD") - k("KeyA");
    c.heave = k("KeyF") + k("PageDown") - k("KeyR") - k("PageUp");
    c.ballast = k("KeyW") - k("KeyS");
    // mouse
    c.lookX = this.mouse.dx * 0.004;
    c.lookY = this.mouse.dy * 0.004;
    c.zoom = this.mouse.wheel;
    this.mouse.dx = this.mouse.dy = this.mouse.wheel = 0;

    const gp = this.gamepad();
    if (gp) {
      this.gamepadName = gp.id;
      const ax = gp.axes;
      const b = (i: number) => gp.buttons[i]?.value ?? 0;
      c.surge = clamp(c.surge - dz(ax[1] ?? 0));
      c.yaw = clamp(c.yaw - dz(ax[0] ?? 0));
      c.lookX += dz(ax[2] ?? 0) * 0.04;
      c.lookY += dz(ax[3] ?? 0) * 0.04;
      c.heave = clamp(c.heave + b(7) - b(6)); // RT down, LT up
      c.ballast = clamp(c.ballast + (b(5) > 0.5 ? 1 : 0) - (b(4) > 0.5 ? 1 : 0));
      const pressed = gp.buttons.map((x) => x.pressed);
      const edge = (i: number) => pressed[i] && !this.prevButtons[i];
      if (edge(0)) this.actions.push("interact");
      if (edge(1)) this.actions.push("drop");
      if (edge(2)) this.actions.push("lights");
      if (edge(3)) this.actions.push("camera");
      if (edge(8)) this.actions.push("photo");
      if (edge(9)) this.actions.push("pause");
      if (edge(12)) this.actions.push("depthHold");
      if (edge(13)) this.actions.push("surfaceTanks");
      if (edge(10) && pressed[11]) this.actions.push("emergency"); // both stick clicks
      this.prevButtons = pressed;
    }
  }

  /**
   * Rumble: strong = low-frequency motor, weak = high-frequency motor.
   * Uses the Gamepad API vibration actuator where the browser supports it.
   */
  rumble(strong: number, weak: number, ms: number) {
    const gp = this.gamepad() as (Gamepad & { vibrationActuator?: { playEffect: (t: string, p: object) => Promise<unknown> } }) | null;
    gp?.vibrationActuator?.playEffect("dual-rumble", { duration: ms, strongMagnitude: clamp01(strong), weakMagnitude: clamp01(weak) }).catch(() => {});
  }
}

const clamp = (v: number) => Math.max(-1, Math.min(1, v));
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
