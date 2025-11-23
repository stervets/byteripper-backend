// src/app.module.ts
import { Module } from '@nestjs/common';
import { EvmModule } from './evm/evm.module';
import { CliModule } from './cli/cli.module';
import { ScriptsModule } from './scripts/scripts.module';

@Module({
  imports: [EvmModule, CliModule, ScriptsModule],
})
export class AppModule {}
