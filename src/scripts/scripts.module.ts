// src/scripts/scripts.module.ts
import { Module } from '@nestjs/common';
import { ScriptRunnerService } from './runner.service';

@Module({
  providers: [ScriptRunnerService],
  exports: [ScriptRunnerService],
})
export class ScriptsModule {}
