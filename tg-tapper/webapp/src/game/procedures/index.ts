import type { ToolId } from '@shared/game.ts';
import type { Engine, Procedure } from '../engine.ts';
import { acupunctureProcedure } from './acupuncture.ts';
import type { ProcCtx } from './common.ts';
import { oilProcedure, tickleProcedure, washProcedure } from './spa.ts';
import { removalProcedure, tattooProcedure } from './tattoo.ts';
import { woundProcedure } from './wound.ts';

export type { ProcCtx, TattooSave } from './common.ts';
export { restoreTattoo } from './tattoo.ts';

export function createProcedure(id: ToolId, e: Engine, ctx: ProcCtx): Procedure {
  switch (id) {
    case 'oil':
      return oilProcedure(e);
    case 'wash':
      return washProcedure(e);
    case 'tickle':
      return tickleProcedure(e);
    case 'needles':
      return acupunctureProcedure(e, ctx);
    case 'tattoo':
      return tattooProcedure(e, ctx);
    case 'removal':
      return removalProcedure(e, ctx);
    case 'wound':
      return woundProcedure(e);
  }
}
