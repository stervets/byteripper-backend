import { Injectable, Logger } from '@nestjs/common';
import {
  Ctx,
  CtxPhase,
  CtxSnapshot,
  PcMark,
  RunnerEnv,
  RunnerOutput,
  ScriptLifecycle,
  ScriptResult,
  StepSnapshot,
  ViewDescriptor,
} from './types';
import { TraceStep } from '../evm/types';
import { safeDeepClone } from '../common/utils';

function cloneStep(step: TraceStep | undefined): StepSnapshot | undefined {
  if (!step) return undefined;
  return {
    pc: step.pc,
    opcode: step.opcode,
    stack: step.stack.map((x) => x.toString()), // bigint → string
    rawMemory: step.rawMemory ? [...step.rawMemory] : undefined,
    rawStorage: step.rawStorage ? { ...step.rawStorage } : undefined,
  };
}

@Injectable()
export class ScriptRunnerService {
  private readonly logger = new Logger(ScriptRunnerService.name);

  async runForTx(
    env: RunnerEnv,
    scripts: ScriptLifecycle[],
  ): Promise<RunnerOutput> {
    if (!scripts.length) {
      return { scripts: [], views: [], marks: [], snapshots: [] };
    }

    const sorted = this.sortByDependencies(scripts);

    const shared: Record<string, any> = {};
    const marks: PcMark[] = [];
    const views: ViewDescriptor[] = [];
    const results = new Map<string, any>();
    const storeMap = new Map<string, Record<string, any>>();

    const snapshots: CtxSnapshot[] = [];

    const getResult = (id: string) => results.get(id);
    const setResult = (id: string, v: any) => results.set(id, v);

    // Создание ctx
    const buildCtx = (
      scriptId: string,
      stepIndex: number,
      step?: TraceStep,
    ): Ctx => {
      const store = storeMap.get(scriptId)!;

      const st =
        step ??
        (env.trace.length > 0 ? env.trace[stepIndex] : (undefined as any));

      const pc = st?.pc ?? 0;
      const opcodeName = st?.opcode ?? 'INVALID';
      const opcodeByte =
        env.runtimeDisasm.find((b) => b.pc === pc)?.byte ?? 0xff;

      // Флаги
      const op = opcodeName.toUpperCase();
      const isJump = op === 'JUMP' || op === 'JUMPI';
      const isCall =
        op === 'CALL' ||
        op === 'DELEGATECALL' ||
        op === 'STATICCALL' ||
        op === 'CALLCODE';
      const isTerminator =
        op === 'STOP' ||
        op === 'RETURN' ||
        op === 'REVERT' ||
        op === 'SELFDESTRUCT' ||
        op === 'INVALID';
      const isPush = op.startsWith('PUSH');
      const isDup = op.startsWith('DUP');
      const isSwap = op.startsWith('SWAP');

      return {
        contractAddress: env.contractAddress,
        runtimeBytecode: env.runtimeBytecode,
        creationBytecode: env.creationBytecode,

        runtimeDisasm: env.runtimeDisasm,
        creationDisasm: env.creationDisasm,

        trace: env.trace,
        tx: env.tx,
        isCreationPhase: env.isCreationPhase,

        stepIndex,
        step: st,
        pc,
        opcodeByte,
        opcodeName,

        stack: st?.stack ?? [],
        memory: undefined,
        storage: st?.rawStorage,

        isJump,
        isCall,
        isTerminator,
        isPush,
        isDup,
        isSwap,

        store,
        shared,

        log: (msg: string) => console.log(`[${scriptId}] ${msg}`),
        warn: (msg: string) => console.warn(`[${scriptId}] WARN: ${msg}`),
        error: (msg: string) => console.error(`[${scriptId}] ERROR: ${msg}`),

        markPc: (pcVal, kind, label) => {
          marks.push({ pc: pcVal, kind, label, scriptId });
        },

        registerView: (view: ViewDescriptor) => {
          (view as any).scriptId = scriptId;
          views.push(view);
        },

        getResult,
        setResult,
      };
    };

    const snapshot = (
      scriptId: string,
      phase: CtxPhase,
      stepIndex: number,
      ctx: Ctx,
    ) => {
      snapshots.push({
        scriptId,
        phase,
        stepIndex,
        snapshot: {
          step: cloneStep(ctx.step),
          store: safeDeepClone(ctx.store),
          shared: safeDeepClone(ctx.shared),
        },
      });
    };

    // ---------- СТАРТ ЦИКЛА ЖИЗНИ ----------

    // Инициализируем store
    for (const s of sorted) storeMap.set(s.id, {});

    // onTxStart
    for (const s of sorted) {
      if (s.onTxStart) {
        const ctx = buildCtx(s.id, 0);
        await s.onTxStart(ctx);
        snapshot(s.id, 'onTxStart', 0, ctx);
      }
    }

    // onStart
    for (const s of sorted) {
      if (s.onStart) {
        const ctx = buildCtx(s.id, 0);
        await s.onStart(ctx);
        snapshot(s.id, 'onStart', 0, ctx);
      }
    }

    // ----------- ШАГИ ТРЕЙСА -----------
    for (let i = 0; i < env.trace.length; i++) {
      for (const s of sorted) {
        if (s.onStep) {
          const ctx = buildCtx(s.id, i, env.trace[i]);
          await s.onStep(ctx, env.trace[i]);
          snapshot(s.id, 'onStep', i, ctx);
        }
      }
    }

    const scriptResults: ScriptResult[] = [];

    // onFinish
    for (const s of sorted) {
      if (s.onFinish) {
        const last = Math.max(0, env.trace.length - 1);
        const ctx = buildCtx(s.id, last);
        const data = await s.onFinish(ctx);
        snapshot(s.id, 'onFinish', last, ctx);

        if (data !== undefined) {
          results.set(s.id, data);
          scriptResults.push({ scriptId: s.id, data });
        }
      }
    }

    // onTxEnd
    for (const s of sorted) {
      if (s.onTxEnd) {
        const last = Math.max(0, env.trace.length - 1);
        const ctx = buildCtx(s.id, last);
        await s.onTxEnd(ctx);
        snapshot(s.id, 'onTxEnd', last, ctx);
      }
    }

    return {
      scripts: scriptResults,
      views,
      marks,
      snapshots,
    };
  }

  async runOnDeploy(
    env: RunnerEnv,
    scripts: ScriptLifecycle[],
  ): Promise<RunnerOutput> {
    const snapshots: CtxSnapshot[] = [];
    const marks: PcMark[] = [];
    const views: ViewDescriptor[] = [];
    const scriptResults: ScriptResult[] = [];
    const shared = {};

    const buildCtx = (scriptId: string): Ctx => ({
      // статический контекст:
      contractAddress: env.contractAddress,
      runtimeBytecode: env.runtimeBytecode,
      creationBytecode: env.creationBytecode,
      runtimeDisasm: env.runtimeDisasm,
      creationDisasm: env.creationDisasm,
      trace: env.trace,
      tx: env.tx,
      isCreationPhase: env.isCreationPhase,

      // шаги: на deploy шага нет
      stepIndex: -1,
      step: undefined as any,
      pc: 0,
      opcodeByte: 0,
      opcodeName: '',

      // state:
      store: {}, // отдельный store на скрипт
      shared, // либо общий объект, если ты его держишь

      // утилиты:
      log: (msg) => this.logger.log(`[${scriptId}] ${msg}`),
      warn: (msg) => this.logger.warn(`[${scriptId}] ${msg}`),
      error: (msg) => this.logger.error(`[${scriptId}] ${msg}`),
      markPc: () => {},
      registerView: () => {},
      getResult: () => {},
      stack: [],
      isJump: false,
      isCall: false,
      isTerminator: false,
      isPush: false,
      isDup: false,
      isSwap: false,
      setResult: function (): void {
        throw new Error('Function not implemented.');
      },
    });

    const snapshot = (scriptId: string, ctx: Ctx) => {
      snapshots.push({
        scriptId,
        phase: 'onDeploy',
        stepIndex: -1,
        snapshot: {
          step: undefined,
          store: safeDeepClone(ctx.store),
          shared: safeDeepClone(ctx.shared),
        },
      });
    };

    for (const s of scripts) {
      if (!s.onDeploy) continue;

      const ctx = buildCtx(s.id);
      await s.onDeploy(ctx);
      snapshot(s.id, ctx);
    }

    return { scripts: scriptResults, marks, views, snapshots };
  }
  // ----------- DEPENDENCY SORT ----------
  private sortByDependencies(scripts: ScriptLifecycle[]): ScriptLifecycle[] {
    const byId = new Map<string, ScriptLifecycle>();
    const indeg = new Map<string, number>();
    const adj = new Map<string, string[]>();

    for (const s of scripts) {
      if (byId.has(s.id)) {
        throw new Error(`Duplicate script ID: ${s.id}`);
      }
      byId.set(s.id, s);
      indeg.set(s.id, 0);
      adj.set(s.id, []);
    }

    for (const s of scripts) {
      for (const dep of s.dependsOn || []) {
        if (!byId.has(dep))
          throw new Error(`Script "${s.id}" depends on missing "${dep}"`);

        indeg.set(s.id, (indeg.get(s.id) ?? 0) + 1);
        adj.get(dep)!.push(s.id);
      }
    }

    const q = [...[...indeg].filter(([_, v]) => v === 0)].map(([id]) => id);

    const out: ScriptLifecycle[] = [];

    while (q.length) {
      const id = q.shift()!;
      out.push(byId.get(id)!);

      for (const nxt of adj.get(id)!) {
        indeg.set(nxt, indeg.get(nxt)! - 1);
        if (indeg.get(nxt) === 0) q.push(nxt);
      }
    }

    if (out.length !== scripts.length) {
      throw new Error('Cyclic script dependencies detected');
    }

    return out;
  }
}
