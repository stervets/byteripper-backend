// src/app.module.ts
import { Module } from '@nestjs/common';
import { EvmModule } from './evm/evm.module';
import { CliModule } from './cli/cli.module';

@Module({
  imports: [EvmModule, CliModule],
})
export class AppModule {}
