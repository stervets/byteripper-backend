import type { ScriptLifecycle, Ctx } from '../../src/scripts/types';

const script: ScriptLifecycle = {
  id: 'user.myFirstCheck',
  dependsOn: ['core.heatmap'],

  onDeploy(ctx: Ctx){
    ctx.log('User script onDeploy executed');
  },

  onFinish(ctx: Ctx) {
    const heatmap = ctx.getResult('core.heatmap');
    ctx.log(`Heatmap totalSteps = ${heatmap?.totalSteps}`);

    if (!heatmap?.pcHits) {
      return { error: 'no heatmap data' };
    }

    const entries = Object.entries(heatmap.pcHits) as [string, number][];
    if (!entries.length) {
      return { error: 'empty heatmap' };
    }

    const [hottestPc, hottestCount] = entries.sort(
      (a, b) => b[1] - a[1],
    )[0];

    ctx.markPc(Number(hottestPc), 'danger', 'Hottest PC');

    return {
      hottestPc: Number(hottestPc),
      hottestCount,
    };
  },
};

export default script;