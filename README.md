# EVM ByteRipper Backend

Backend — это минималистичный движок для запуска EVM-транзакции, съёма трейса и прогонки его через скриптовый рантайм.

Он **ничего не знает** про аналитику: вся логика анализа живёт в скриптах (TypeScript), а бекенд отвечает только за:

- работу с Anvil (деплой контракта, отправка транзакций)
- получение `runtimeBytecode` / `creationBytecode`
- дизассемблирование байткода в `{ pc, byte }`
- получение `debug_traceTransaction`
- сбор `RunnerEnv`
- загрузку/запуск скриптов и возврат результатов

Фронтенд (потом) будет просто отрисовывать JSON, который вернёт бекенд.

---

## Стек

- Node.js + Yarn
- NestJS
- Anvil (foundry) как локальный EVM-узел
- ethers v6 для RPC/транзакций

---

## Структура проекта

Ожидаемая структура каталога `backend`:

```text
backend/
  src/
    main.ts
    app.module.ts

    evm/
      evm.module.ts
      evm.service.ts          # деплой, отправка транзакций, базовый RPC
      bytecode.ts             # дизассемблер runtime/creation байткода в RawByte[]
      trace-adapter.ts        # адаптер debug_traceTransaction → TraceStep[]
      opcodes-list.ts         # справочник опкодов
      abi.types.ts            # типы для метаданных транзакций и ABI
      workspace.service.ts    # (опционально) работа с путями/артефактами

    cli/
      cli.module.ts
      cli.service.ts          # точка входа CLI: принимает argv, гоняет пайплайн

    scripts/
      types.ts                # Ctx, ScriptLifecycle, RunnerEnv, CtxSnapshot и т.п.
      runner.service.ts       # ScriptRunnerService: lifecycle скриптов
      script-loader.service.ts# ScriptLoaderService: загрузка core/user скриптов
      scripts.module.ts       # экспорт ScriptRunnerService
      script-loader.module.ts # экспорт ScriptLoaderService

  script/
    core/
      index.json              # список core-скриптов
      heatmap.ts              # пример системного скрипта: PC heatmap и view

    user/
      index.json              # список пользовательских скриптов
      my-first-check.ts       # пример user-скрипта
```

> В git можно включать только `script/core`, а `script/user` при желании добавить в `.gitignore` как локальную песочницу.

---

## Жизненный цикл CLI

Запуск:

```bash
yarn dev <target>
```

Где `<target>`:

- либо путь к артефакту JSON (например, forge):  
  `../../playground/out/test1.sol/Test1.json`
- либо путь к файлу с **runtime байткодом** (одна строка `0x...`):  
  `../runtime-loop.txt`

Пайплайн `CliService`:

1. Разобрать аргумент:
   - если `.json` → прочитать артефакт, достать `runtimeBytecode` и (если есть) `creationBytecode`
   - иначе → считать файл как чистый `runtimeBytecode`
2. Задеплоить контракт в Anvil:
   - если есть `creationBytecode` → деплоим как есть
   - если только `runtimeBytecode` → оборачиваем в минимальный init-код и деплоим
3. Получить `contractAddress`.
4. Сделать дизассемблирование:
   - `runtimeDisasm: RawByte[]` — массив `{ pc, byte }`
   - `creationDisasm: RawByte[]` — если есть creation-код
5. Отправить простую транзакцию на контракт (без calldata, пока как smoke-test).
6. Получить `debug_traceTransaction` от Anvil.
7. Преобразовать raw trace → `TraceStep[]` (pc, opcode, gas, stack, rawMemory, rawStorage…).
8. Собрать `RunnerEnv`:
   - `contractAddress`
   - `runtimeBytecode` / `creationBytecode`
   - `runtimeDisasm` / `creationDisasm`
   - `trace: TraceStep[]`
   - `tx: TxMeta` (hash, from, to, value, gasUsed, status, input, nonce…)
   - `isCreationPhase` (bool)
9. Загрузить все скрипты через `ScriptLoaderService` (core + user).
10. Прогнать всё через `ScriptRunnerService.runForTx(env, scripts)`.
11. Вывести в лог:
    - результаты скриптов (`scripts`)
    - зарегистрированные view (`views`)
    - метки по PC (`marks`)
    - снапшоты (`snapshots`) — для форензики скриптов, не для пользователя.

---

## Скриптовая система

### Интерфейс скрипта

Скрипт — это обычный TS-файл, который экспортирует `default`:

```ts
import type { ScriptLifecycle, Ctx } from '../../src/scripts/types';

const script: ScriptLifecycle = {
  id: 'core.heatmap',
  dependsOn: [],

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
```

Точки расширения:

- `id: string` — глобальный идентификатор скрипта (например, `core.heatmap`, `user.myFirstCheck`)
- `dependsOn?: string[]` — список других скриптов, чьи результаты нужны (по `id`)
- `onTxStart?(ctx)` — вызывается один раз на транзакцию, до обхода трейса
- `onStart?(ctx)` — вызывается один раз перед первым шагом трейса
- `onStep?(ctx, step)` — вызывается для каждого шага трейса
- `onFinish?(ctx)` — вызывается один раз после последнего шага; результат сохраняется в `RunnerOutput.scripts`
- `onTxEnd?(ctx)` — финальный хук после всего цикла

### Где лежат скрипты

Core-скрипты:

```text
backend/script/core/index.json
backend/script/core/*.ts
```

Пример `backend/script/core/index.json`:

```json
{
  "scripts": [
    {
      "file": "heatmap.ts",
      "enabled": true
    }
  ]
}
```

User-скрипты:

```text
backend/script/user/index.json
backend/script/user/*.ts
```

Пример `backend/script/user/index.json`:

```json
{
  "scripts": [
    {
      "file": "my-first-check.ts",
      "enabled": true
    }
  ]
}
```

ID и зависимости (`id`, `dependsOn`) задаются **только в TS-файле**, `index.json` отвечает за то, какие файлы вообще грузить.

---

## Ctx (контекст скрипта)

Скрипт получает на вход объект `ctx: Ctx`, который содержит:

### Статический контекст

- `contractAddress: string`
- `runtimeBytecode: string`
- `creationBytecode?: string`
- `runtimeDisasm: RawByte[]` — `{ pc, byte }`
- `creationDisasm: RawByte[]`
- `trace: TraceStep[]` — весь трейс
- `tx: TxMeta` — метаданные транзакции
- `isCreationPhase: boolean` — режим анализа (creation/runtime)

### Текущий шаг

- `stepIndex: number` — индекс шага в трейсе
- `step: TraceStep` — текущий шаг
- `pc: number`
- `opcodeByte: number`
- `opcodeName: string`
- `stack: bigint[]`
- `rawMemory?: string[]`
- `rawStorage?: Record<string, string>`

+ предрасчитанные флаги:

- `isJump`, `isCall`, `isTerminator`, `isPush`, `isDup`, `isSwap`

### Состояние

- `store: Record<string, any>` — личный state скрипта
- `shared: Record<string, any>` — общие данные между скриптами

### Утилиты

- `log(msg: string)` / `warn(msg: string)` / `error(msg: string)` — логирование
- `markPc(pc: number, kind: 'danger' | 'info' | 'warn', label?: string)` — пометка проблемных участков байткода
- `registerView(view: ViewDescriptor)` — регистрация view для фронта (heatmap, таблицы, графы и т.п.)
- `getResult(scriptId: string)` — получить результат другого скрипта (по `id`)
- `setResult(scriptId: string, data: any)` — (опционально) явная запись результата скрипта

---

## RunnerOutput и снапшоты

`ScriptRunnerService.runForTx(env, scripts)` возвращает:

- `scripts: { scriptId, data }[]` — результаты `onFinish`
- `views: ViewDescriptor[]` — зарегистрированные визуализации
- `marks: PcMark[]` — пометки по PC (danger/info/warn)
- `snapshots: CtxSnapshot[]` — форензика состояния `store/shared` и шага по фазам lifecycle

Снапшоты содержат **только динамическое состояние**, без тяжёлых структур:

```ts
export interface CtxSnapshot {
  phase: 'onTxStart' | 'onStart' | 'onStep' | 'onFinish' | 'onTxEnd';
  scriptId: string;
  stepIndex: number;
  snapshot: {
    step?: StepSnapshot; // pc, opcode, stack[], rawMemory, rawStorage
    store: any;
    shared: any;
  };
}
```

---

## Требования к окружению

- Node.js 20+
- Yarn
- Anvil (foundry) запущен локально, по умолчанию на `http://127.0.0.1:8545`

Пример запуска anvil:

```bash
anvil
```

Пример запуска бекенда:

```bash
cd backend
yarn install
yarn dev ../../playground/out/test1.sol/Test1.json
# или
yarn dev ../runtime-loop.txt
```

---

Этот README описывает текущую архитектуру бекенда EVM ByteRipper:  
тонкий NestJS-движок + TS-скриптовый рантайм для forensic-анализа байткода и трейсов EVM.
