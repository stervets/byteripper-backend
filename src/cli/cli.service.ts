// src/cli/cli.service.ts
import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';
import { EvmService } from '../evm/evm.service';
import { BytecodeService } from '../evm/bytecode.service';

@Injectable()
export class CliService {
  private readonly logger = new Logger(CliService.name);

  constructor(
    private readonly evm: EvmService,
    private readonly bytecode: BytecodeService,
  ) {}

  async run(argv: string[]): Promise<void> {
    if (!argv[0]) {
      this.logger.error('Usage: yarn dev <path-to-json-or-runtime-hex-file>');
      return;
    }

    const targetPath = path.resolve(argv[0]);
    this.logger.log(`Target: ${targetPath}`);

    const ext = path.extname(targetPath).toLowerCase();

    let deployResult;

    if (ext === '.json') {
      // режим: JSON-артефакт (Foundry/Hardhat)
      deployResult = await this.evm.loadFromJsonAndMaybeDeploy(targetPath);
    } else {
      // режим: файл с runtime-байткодом (0x...)
      const content = await fs.readFile(targetPath, 'utf8');
      const runtimeBytecode = content.trim();
      deployResult = await this.evm.fromRuntimeOnly(runtimeBytecode);
    }

    const { contractAddress, runtimeBytecode } = deployResult;

    this.logger.log(`Runtime bytecode length: ${runtimeBytecode.length / 2} bytes`);
    if (contractAddress) {
      this.logger.log(`Contract deployed at: ${contractAddress}`);
    } else {
      this.logger.warn('Contract was not deployed (runtime-only mode).');
    }

    const disasm = this.bytecode.disassemble(runtimeBytecode);

    // Пока просто в консоль
    this.logger.log('First 32 bytes of disasm:');
    for (let i = 0; i < Math.min(disasm.length, 32); i++) {
      const b = disasm[i];
      console.log(`${b.pc.toString().padStart(4, ' ')}: 0x${b.byte.toString(16).padStart(2, '0')}`);
    }
  }
}
