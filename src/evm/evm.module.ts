// src/evm/evm.module.ts
import { Module } from '@nestjs/common';
import { EvmService } from './evm.service';
import { BytecodeService } from './bytecode.service';
import { TraceService } from './trace.service';
import { JsonRpcProvider } from 'ethers';
import { AccountService } from './account.service';

@Module({
  providers: [
    {
      provide: JsonRpcProvider,
      useFactory: () => {
        const rpcUrl = process.env.RPC_URL ?? 'http://127.0.0.1:8545';
        return new JsonRpcProvider(rpcUrl);
      },
    },
    AccountService,
    EvmService,
    BytecodeService,
    TraceService,
  ],
  exports: [AccountService, EvmService, BytecodeService, TraceService],
})
export class EvmModule {}