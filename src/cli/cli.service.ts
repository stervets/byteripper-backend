// src/cli/cli.service.ts
import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';
import { EvmService } from '../evm/evm.service';
import { BytecodeService } from '../evm/bytecode.service';
import { TraceService } from '../evm/trace.service';

@Injectable()
export class CliService {
  private readonly logger = new Logger(CliService.name);

  constructor(
    private readonly evm: EvmService,
    private readonly bytecode: BytecodeService,
    private readonly traceService: TraceService,
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
      deployResult = await this.evm.loadFromJsonAndMaybeDeploy(targetPath);
    } else {
      const content = await fs.readFile(targetPath, 'utf8');
      const runtimeBytecode = content.trim();
      deployResult = await this.evm.fromRuntimeOnly(runtimeBytecode);
    }

    const { contractAddress, runtimeBytecode } = deployResult;

    this.logger.log(
      `Runtime bytecode length: ${runtimeBytecode.length / 2} bytes`,
    );
    if (contractAddress) {
      this.logger.log(`Contract deployed at: ${contractAddress}`);
    } else {
      this.logger.warn('Contract was not deployed (runtime-only mode).');
    }

    const disasm = this.bytecode.disassemble(runtimeBytecode);

    this.logger.log('First 32 bytes of disasm:');
    for (let i = 0; i < Math.min(disasm.length, 32); i++) {
      const b = disasm[i];
      console.log(
        `${b.pc.toString().padStart(4, ' ')}: 0x${b.byte
          .toString(16)
          .padStart(2, '0')}`,
      );
    }

    if (!contractAddress) {
      this.logger.warn(
        'No contract address, skipping tx/trace (runtime-only without deploy).',
      );
      return;
    }

    // 🔥 Простая tx и трейс
    const txHash = await this.evm.sendSimpleTx(contractAddress);
    this.logger.log(`Tracing tx: ${txHash}`);

    const steps = await this.traceService.debugTrace(txHash);

    this.logger.log(`Trace steps: ${steps.length}`);
    this.logger.log('First 10 trace steps:');

    for (let i = 0; i < Math.min(steps.length, 10); i++) {
      const s = steps[i];
      console.log(
        `#${i.toString().padStart(3, ' ')} pc=${s.pc
          .toString()
          .padStart(4, ' ')} op=${s.opcode.padEnd(12, ' ')} gas=${s.gas}`,
      );
    }
  }
}
