// src/app.module.ts
import { Module } from '@nestjs/common';
import { EvmModule } from './evm/evm.module';
import { CliModule } from './cli/cli.module';
import { ScriptsModule } from './scripts/scripts.module';
import { ScriptsLoaderModule } from './scripts/script-loader.module';

@Module({
  imports: [EvmModule, ScriptsLoaderModule, CliModule, ScriptsModule],
})
export class AppModule {}
