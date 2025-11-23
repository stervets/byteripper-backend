// src/cli/cli.module.ts
import { Module } from '@nestjs/common';
import { CliService } from './cli.service';
import { EvmModule } from '../evm/evm.module';

@Module({
  imports: [EvmModule],
  providers: [CliService],
})
export class CliModule {}
