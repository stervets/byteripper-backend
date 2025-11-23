import type { ScriptLifecycle, Ctx } from '../../src/scripts/types';

const script: ScriptLifecycle = {
  id: 'user.myFirstCheck',
  dependsOn: ['core.heatmap'],

  onFinish(ctx: Ctx) {
    const heatmap = ctx.getResult('core.heatmap');
    ctx.log(`heatmap totalSteps = ${heatmap?.totalSteps}`);

    // можно вернуть свои данные
    return {
      msg: 'hello from user script',
      maxPc: Object.entries(heatmap.pcHits || {})
        .sort((a: any, b: any) => b[1] - a[1])[0]?.[0],
    };
  },
};

export default script;
