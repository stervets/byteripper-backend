// backend/script/core/heatmap.ts
import type { Ctx, ScriptLifecycle } from '../../src/scripts/types';

const script: ScriptLifecycle = {
  id: 'core.heatmap',

  onStart(ctx: Ctx) {
    ctx.store.pcHits = new Map<number, number>();
  },

  onStep(ctx: Ctx) {
    const pcHits: Map<number, number> =
      ctx.store.pcHits ?? new Map<number, number>();

    const prev = pcHits.get(ctx.pc) ?? 0;
    pcHits.set(ctx.pc, prev + 1);

    ctx.store.pcHits = pcHits;
  },

  onFinish(ctx: Ctx) {
    const pcHits: Map<number, number> =
      ctx.store.pcHits ?? new Map<number, number>();

    const data: Record<number, number> = {};
    for (const [pc, count] of pcHits.entries()) {
      data[pc] = count;
    }

    const payload = {
      totalSteps: ctx.trace.length,
      pcHits: data,
    };

    ctx.registerView({
      id: 'core.heatmap',
      scriptId: 'core.heatmap',
      type: 'heatmap',
      title: 'PC Heatmap',
      data: payload,
    });

    return payload;
  },
};

export default script;
