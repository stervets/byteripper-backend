/* Ctx для скриптов */

import { RawByte, TraceStep, TxMeta } from '../evm/types';

export interface Ctx {
  // --- Статический контекст анализа ---
  contractAddress: string;
  runtimeBytecode: string;
  creationBytecode?: string;

  runtimeDisasm: RawByte[]; // [{ pc, byte }]
  creationDisasm: RawByte[]; // [{ pc, byte }]

  trace: TraceStep[]; // весь трейс текущей транзакции
  tx: TxMeta; // данные по текущей транзакции
  isCreationPhase: boolean; // true, если это init-транзакция

  // --- Текущий шаг ---
  stepIndex: number; // индекс в trace[]
  step: TraceStep; // alias trace[stepIndex]
  pc: number;

  opcodeByte: number; // byte по текущему PC (если есть в disasm)
  opcodeName: string; // alias step.opcode

  // Алиасы для удобства (из step)
  stack: bigint[];
  memory?: Uint8Array; // нормализованная memory (если захотим)
  storage?: Record<string, string>;

  // --- Флаги (precomputed для удобства) ---
  isJump: boolean; // JUMP / JUMPI
  isCall: boolean; // CALL / DELEGATECALL / STATICCALL / CALLCODE
  isTerminator: boolean; // STOP / RETURN / REVERT / INVALID / SELFDESTRUCT
  isPush: boolean; // PUSH1..PUSH32
  isDup: boolean; // DUP1..DUP16
  isSwap: boolean; // SWAP1..SWAP16

  // --- Хранилище между вызовами ---
  store: Record<string, any>; // личный state скрипта
  shared: Record<string, any>; // общие данные между скриптами

  // --- Логи ---
  log(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;

  // --- Метки PC для фронта ---
  markPc(pc: number, kind: 'danger' | 'info' | 'warn', label?: string): void;

  // --- Регистрация view'шек для фронта ---
  registerView(view: ViewDescriptor): void;

  // --- Межскриптовый обмен ---
  getResult(scriptId: string): any | undefined;
  setResult(scriptId: string, value: any): void;
}

export interface CtxSnapshot {
  phase: 'onTxStart' | 'onStart' | 'onStep' | 'onFinish' | 'onTxEnd';
  scriptId: string;
  stepIndex: number;
  ctx: Ctx; // глубокий clone
}

/* Жизненные хуки скриптов */
export interface ScriptLifecycle {
  /**
   * ID скрипта. Используется для:
   * - dependsOn
   * - хранения результатов
   * - привязки view
   * *
   * * Нужно, чтобы:
   * * - раннер мог выполнять скрипты в правильном порядке
   * * - один скрипт мог использовать результат другого (getResult())
   * *
   */
  id: string;

  /**
   * список ID других скриптов, чьи результаты нужны перед стартом этого
   */
  dependsOn?: string[];

  /**
   * вызывается, когда контракт заново задеплоен
   * (или при первой загрузке, если deploy был в этом запуске)
   *
   * Важно, потому что:
   * - некоторые скрипты анализируют init-код
   * - некоторые скрипты строят структуры, которые зависят от байткода
   * - init-код может перегенерироваться при повторном запуске
   */
  onRedeploy?: (ctx: Ctx) => Promise<void> | void;

  /**
   * вызывается на каждый новый tx (даже если trace пустой)
   *
   * Позволяет:
   * - сбрасывать state
   * - открывать "новый seance" анализа
   * - работать даже с транзакциями без trace (например revert до первого opcode)
   */
  onTxStart?: (ctx: Ctx) => Promise<void> | void;

  /**
   * вызывается перед началом прохода по trace
   * *
   * Это точка, когда trace уже есть, но по нему ещё никто не проходился:
   * - удобно инициализировать большие структуры типа pcStats
   * - можно заранее просчитать что-то одноразовое
   */
  onStart?: (ctx: Ctx) => Promise<void> | void;

  /**
   * вызывается на каждом trace-step
   *
   * Главная рабочая функция любого анализа:
   * - построение CFG
   * - поиск unreachable
   * - heatmap
   * - storage-diff
   * - byte anomalies
   * - JUMP таблицы
   */
  onStep?: (ctx: Ctx, step: TraceStep) => Promise<void> | void;

  /**
   * вызывается после завершения прохода по trace
   * возвращает результат скрипта
   *
   * Позволяет вернуть:
   * - view
   * - summary
   * - матрицы данных
   * - payload скрипта
   *
   */
  onFinish?: (ctx: Ctx) => Promise<any> | any;

  /**
   * вызывается после окончания анализа транзакции
   * (после того как все скрипты завершены)
   */
  onTxEnd?: (ctx: Ctx) => Promise<void> | void;
}

/* ViewDescriptor (как скрипты общаются с фронтом) */

export interface ViewDescriptor {
  id: string; // уникальный id view в рамках одного запуска
  scriptId: string; // чей это view (cfg, heatmap, и т.д.)
  type: ViewType;
  title?: string;
  data: any; // фронт знает, как интерпретировать по type
}

export type ViewType =
  | 'heatmap'
  | 'table'
  | 'list'
  | 'graph'
  | 'timeline'
  | 'storage-diff'
  | 'custom';

/* Итоговый результат скрипта */

export interface ScriptResult {
  scriptId: string;
  data: any; // что вернул onFinish
}

// Метка PC для фронта
export interface PcMark {
  pc: number;
  kind: 'danger' | 'info' | 'warn';
  label?: string;
  scriptId: string;
}

// Окружение для запуска скриптов по одной транзакции
export interface RunnerEnv {
  contractAddress: string;
  runtimeBytecode: string;
  creationBytecode?: string;

  runtimeDisasm: RawByte[];
  creationDisasm: RawByte[];

  trace: TraceStep[];
  tx: TxMeta;
  isCreationPhase: boolean;
}

// Итог работы раннера по одной транзакции
export interface RunnerOutput {
  scripts: ScriptResult[];
  views: ViewDescriptor[];
  marks: PcMark[];
  snapshots: CtxSnapshot[];
}
