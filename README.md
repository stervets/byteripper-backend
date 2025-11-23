# EVM ByteRipper — Backend

Forensic-grade движок анализа байткода и трейсов EVM.  
Этот репозиторий — **только backend-ядро** ByteRipper.

---

## 🧠 Идея

Backend делает **минимальный честный минимум**:

* подключается к EVM-ноде (обычно `anvil`)
* деплоит контракт:
  * либо из JSON-артефакта (Foundry/Hardhat)
  * либо из голого `runtimeBytecode` (оборачивая его в минимальный init-код)
* исполняет транзакции на контракте
* получает `debug_traceTransaction`
* делает *raw* disasm байткода: `{ pc, byte }`
* формирует контекст исполнения (`Ctx`) и пробрасывает его в ScriptRunner

Вся аналитика (CFG, unreachable, security-паттерны, heatmap, storage-diff и т.д.)
живет в **TS-скриптах**, а не в backend-ядре.

Backend = **тонкий EVM-проводник + генератор Ctx**.

---

## 📁 Структура (MVP)

```txt
backend/
  src/
    main.ts
    app.module.ts

    cli/
      cli.module.ts
      cli.service.ts

    evm/
      evm.module.ts
      evm.service.ts
      bytecode.service.ts
      trace.service.ts
      account.service.ts
      types.ts

    scripts/          # (дальше)
      scripts.module.ts
      runner.service.ts
      types.ts        # Ctx, ViewDescriptor, ScriptLifecycle
```

Папки `scripts/` пока могут быть пустыми — они появятся, когда подключим ScriptRunner.

---

## 🚀 Запуск

### Требования

* Node.js (20+)
* yarn
* локальная EVM-нода (по умолчанию `anvil`)

```bash
anvil
```

Backend по умолчанию лезет на `http://127.0.0.1:8545`  
(можно переопределить через `RPC_URL`).

### Dev-запуск

```bash
yarn dev path/to/contract.json
# или
yarn dev path/to/runtime.txt
```

Где:

* `contract.json` — артефакт компиляции Solidity (Foundry/Hardhat), содержащий:
  * `bytecode` (creation)
  * `deployedBytecode` (runtime)
* `runtime.txt` — текстовый файл с `0x...` runtime-кодом

При запуске backend:

1. читает файл
2. деплоит контракт в `anvil`:
   * из `bytecode` (если есть)
   * или, если есть только runtime, — оборачивает его в минимальный init-код и деплоит
3. делает первичный disasm runtime-кода
4. шлёт простую транзу на контракт
5. забирает `debug_traceTransaction` и печатает первые шаги трейса

---

## 📦 Что уже умеет backend

* Деплой контракта:
  * `loadFromJsonAndMaybeDeploy(path)`
  * `fromRuntimeOnly(runtimeBytecode)`
* Генерация init-кода из runtime:
  * `wrapRuntimeIntoCreation(runtimeHex)`
* Первичный disasm:
  * `BytecodeService.disassemble(runtimeBytecode) → RawByte[]`
* Отправка транзакции:
  * `sendSimpleTx(to, fromIndex = 0)`
* Получение трейса:
  * `TraceService.debugTrace(txHash) → TraceStep[]`
* Работа с аккаунтами anvil:
  * `AccountService.loadAccounts() / get(index)`

---

## 🧱 Ctx (контекст для скриптов)

Backend не анализирует контракт.  
Он просто формирует **богатый контекст исполнения**, который передаётся в ScriptRunner.

Идея:

```ts
interface Ctx {
  // --- Статический контекст анализа ---
  contractAddress: string;
  runtimeBytecode: string;
  creationBytecode?: string;

  runtimeDisasm: RawByte[];     // [{ pc, byte }]
  creationDisasm: RawByte[];    // [{ pc, byte }]

  trace: TraceStep[];           // весь трейс
  tx: TxMeta;                   // данные по текущей транзакции
  isCreationPhase: boolean;     // init-code vs runtime

  // --- Текущий шаг ---
  stepIndex: number;
  step: TraceStep;
  pc: number;

  opcodeByte: number;
  opcodeName: string;

  // Алиасы для удобства
  stack: bigint[];
  memory: Uint8Array | undefined;
  storage: Record<string, string> | undefined;

  // --- Флаги ---
  isJump: boolean;
  isCall: boolean;
  isTerminator: boolean;
  isPush: boolean;
  isDup: boolean;
  isSwap: boolean;

  // --- Хранилище между вызовами ---
  store: Record<string, any>;   // личный state скрипта
  shared: Record<string, any>;  // общие данные (через dependsOn)

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
```

ScriptRunner будет создавать `Ctx` на каждый шаг трейса и вызывать:

* `onTxStart(ctx)`
* `onStart(ctx)`
* `onStep(ctx)`
* `onFinish(ctx)`
* `onTxEnd(ctx)`

Backend отвечает только за:

* заполнение `Ctx` сырыми данными
* вызов ScriptRunner
* возврат результатов фронту (`views`, `marks`, `scriptResults`)

---

## 🧨 Что backend **не** делает

* не парсит / не декодирует ABI
* не пытается понять сигнатуры функций
* не подменяет байткод
* не скрывает unreachable
* не «улучшает» картину для юзера

Все решения об анализе контракта принимают **скрипты**, а не backend.

---

## Дальше

Следующий шаг после этого README:

1. зафиксировать общий `Ctx` и типы (`TraceStep`, `TxMeta`, `ViewDescriptor`, `ScriptResult`)
2. реализовать `scripts/runner.service.ts` (ScriptRunner)
3. добавить первые core-скрипты (например, простой heatmap по PC).

