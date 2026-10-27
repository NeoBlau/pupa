// Free-play controller: plugs the World + tools + optional order into the Engine as a
// single never-ending "step", so the engine's input, cursor and rendering stay unchanged.

import type { ToolId } from '@shared/game.ts';
import type { Engine, Procedure, Step } from '../engine.ts';
import { World } from './world.ts';
import { SANDBOX_TOOLS, toolOf, type SandboxTool } from './tools.ts';
import { ORDERS, orderOf, type Goal, type Order, type OrderCtx } from './orders.ts';

export { SANDBOX_TOOLS, ORDERS };
export type { Goal, Order, SandboxTool };

export interface SandboxView {
  tool: string;
  order: ToolId | null;
  goals: Goal[];
  complete: boolean;
  force: number;
}

export class Sandbox {
  e: Engine;
  world: World;
  tool: SandboxTool = toolOf('hand');
  order: Order | null = null;
  private ctx: OrderCtx;
  private completed = false;
  private evalT = 0;
  onView: (v: SandboxView) => void = () => {};
  onOrderDone: (o: Order, score: number) => void = () => {};

  constructor(e: Engine, ctx: OrderCtx) {
    this.e = e;
    this.ctx = ctx;
    this.world = new World(e);
    e.setProcedure(this.procedure());
  }

  /** New patient: fresh world on the same foot. */
  reset() {
    this.order?.dispose?.(this.world);
    this.world.dispose();
    for (const id of ['oil', 'gloss', 'wet', 'foam', 'blood', 'pus', 'smudge', 'stencil', 'frost', 'ink', 'shade'] as const) this.e.clearLayer(id);
    this.e.fadeLayer('redness', 1);
    this.world = new World(this.e);
    this.order = null;
    this.completed = false;
    this.e.debug = {};
    this.emit();
  }

  startOrder(id: ToolId) {
    this.reset();
    this.order = orderOf(id);
    this.order.setup(this.world, this.ctx);
    this.emit();
  }

  setTool(id: string) {
    this.tool = toolOf(id);
    this.e.applyCursor();
    this.e.selectTool(this.tool.subId ?? '');
    this.emit();
  }

  setSub(id: string) {
    this.tool.subId = id;
    this.emit();
  }

  private ctxFor(dt: number) {
    return { w: this.world, e: this.e, p: this.e.ptr, force: this.e.ptr.force, dt };
  }

  private procedure(): Procedure {
    const sb = this;
    const step: Step = {
      title: 'Free play',
      hint: '',
      get cursor() {
        return sb.tool.cursor;
      },
      get tools() {
        return sb.tool.sub;
      },
      get tool() {
        return sb.tool.subId;
      },
      select(id) {
        sb.setSub(id);
      },
      down(p) {
        if (!p.hit) return;
        sb.tool.down?.(sb.ctxFor(0));
      },
      move(p) {
        if (!p.hit) return;
        sb.tool.move?.(sb.ctxFor(0));
      },
      up() {
        sb.tool.up?.(sb.ctxFor(0));
      },
      update(dt) {
        sb.world.update(dt);
        sb.e.toolPose.lift = (sb.tool.lift ?? 0) * (sb.e.ptr.down ? 1 : 0.6);
        const c = sb.ctxFor(dt);
        sb.tool.idle?.(c);
        if (sb.e.ptr.down && sb.e.ptr.hit) sb.tool.hold?.(c);
        sb.evalT += dt;
        if (sb.evalT > 0.25) {
          sb.evalT = 0;
          sb.emit();
        }
      },
      progress: () => 0,
    };
    return { id: 'oil', steps: [step], accuracy: () => 0 };
  }

  private emit() {
    const goals = this.order?.goals(this.world) ?? [];
    const complete = !!this.order && goals.length > 0 && goals.every((g) => g.done);
    if (complete && !this.completed && this.order) {
      this.completed = true;
      this.onOrderDone(this.order, this.order.score(this.world));
    }
    this.onView({ tool: this.tool.id, order: this.order?.id ?? null, goals, complete, force: this.e.ptr.force });
  }
}
