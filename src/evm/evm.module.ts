// src/evm/evm.module.ts
import { Module } from '@nestjs/common';
import { EvmService } from './evm.service';
import { BytecodeService } from './bytecode.service';

@Module({
  providers: [EvmService, BytecodeService],
  exports: [EvmService, BytecodeService],
})
export class EvmModule {}
