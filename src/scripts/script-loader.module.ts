// src/scripts/script-loader.module.ts
import { Module } from '@nestjs/common';
import { ScriptLoaderService } from './script-loader.service';

@Module({
  providers: [ScriptLoaderService],
  exports: [ScriptLoaderService],
})
export class ScriptsLoaderModule {}
