// src/evm/trace.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { JsonRpcProvider } from 'ethers';
import { RawStructLog, TraceResult, TraceStep } from './types';

@Injectable()
export class TraceService {
  private readonly logger = new Logger(TraceService.name);

  constructor(private readonly provider: JsonRpcProvider) {}

  async debugTrace(txHash: string): Promise<TraceStep[]> {
    // anvil / geth-compatible debug_traceTransaction
    const raw = (await (this.provider as any).send(
      'debug_traceTransaction',
      [
        txHash,
        {
          disableStack: false,
          disableMemory: false,
          disableStorage: false,
        },
      ],
    )) as TraceResult;

    const logs: RawStructLog[] =
      (raw as any).structLogs ?? (raw as any).struct_logs ?? [];

    const steps: TraceStep[] = logs.map((log) => ({
      pc: log.pc,
      opcode: log.op,
      gas: log.gas,
      gasCost: log.gasCost,
      depth: log.depth,
      stack: (log.stack ?? []).map((v) => BigInt(v)),
      rawMemory: log.memory,
      rawStorage: log.storage,
    }));

    return steps;
  }
}
