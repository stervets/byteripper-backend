// src/cli/cli.module.ts
import { Module } from '@nestjs/common';
import { CliService } from './cli.service';
import { EvmModule } from '../evm/evm.module';
import { ScriptsModule } from '../scripts/scripts.module';
import { ScriptsLoaderModule } from '../scripts/script-loader.module';

@Module({
  imports: [
    EvmModule,
    ScriptsModule,       // даёт ScriptRunnerService
    ScriptsLoaderModule, // даёт ScriptLoaderService
  ],
  providers: [CliService],
  exports: [CliService],
})
export class CliModule {}
