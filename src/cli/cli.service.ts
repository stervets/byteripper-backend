// src/cli/cli.service.ts
import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';
import { EvmService } from '../evm/evm.service';
import { BytecodeService } from '../evm/bytecode.service';
import { TraceService } from '../evm/trace.service';
import { ScriptRunnerService } from '../scripts/runner.service';
import { ScriptLoaderService } from '../scripts/script-loader.service';
import { RunnerEnv } from '../scripts/types';
import { DeployResult, TxMeta } from '../evm/types';

@Injectable()
export class CliService {
  private readonly logger = new Logger(CliService.name);

  constructor(
    private readonly evm: EvmService,
    private readonly bytecode: BytecodeService,
    private readonly traceService: TraceService,
    private readonly scriptRunner: ScriptRunnerService,
    private readonly scriptLoader: ScriptLoaderService,
  ) {}

  async run(argv: string[]): Promise<void> {
    if (!argv[0]) {
      this.logger.error('Usage: yarn dev <path-to-json-or-runtime-file>');
      return;
    }

    const targetPath = path.resolve(argv[0]);
    this.logger.log(`Target: ${targetPath}`);

    const ext = path.extname(targetPath).toLowerCase();
    let runtimeBytecode: string;
    let creationBytecode: string | undefined;
    let contractAddress: string | undefined;
    let deployed: DeployResult;

    if (ext === '.json') {
      // артефакт
      deployed = await this.evm.loadFromJsonAndMaybeDeploy(targetPath);
      runtimeBytecode = deployed.runtimeBytecode;
      creationBytecode = deployed.creationBytecode;
      contractAddress = deployed.contractAddress;
    } else {
      // файл с runtime-байткодом
      const content = await fs.readFile(targetPath, 'utf8');
      runtimeBytecode = content.trim();
      deployed = await this.evm.fromRuntimeOnly(runtimeBytecode);
      contractAddress = deployed.contractAddress;
      creationBytecode = deployed.creationBytecode;
    }

    if (!contractAddress) {
      this.logger.error('No contract address after deploy, abort.');
      return;
    }

    this.logger.log(
      `Runtime bytecode length: ${(runtimeBytecode.length - 2) / 2} bytes`,
    );
    this.logger.log(`Contract deployed at: ${contractAddress}`);

    const runtimeDisasm = this.bytecode.disassemble(runtimeBytecode);
    const creationDisasm = creationBytecode
      ? this.bytecode.disassemble(creationBytecode)
      : [];

    let env: RunnerEnv = {
      contractAddress,
      runtimeBytecode,
      creationBytecode,
      runtimeDisasm,
      creationDisasm,
      trace: [],             // на deploy можно пустой
      tx: deployed.tx,  // если есть отдельный deploy-tx
      isCreationPhase: false,
    };

    // грузим все скрипты (core + user)
    const scripts = await this.scriptLoader.loadAllScripts();

    const deployOutput = await this.scriptRunner.runOnDeploy(env, scripts);

    this.logger.log('Deploy-time script results:');
    console.dir(deployOutput.scripts, { depth: null });

    // простая транза для получения трейса
    const { txHash, txMeta } = await this.evm.sendSimpleTxWithMeta(
      contractAddress,
    );

    this.logger.log(`Tracing tx: ${txHash}`);

    const trace = await this.traceService.debugTrace(txHash);

    this.logger.log(`Trace steps: ${trace.length}`);
    this.logger.log('First 10 trace steps:');
    for (let i = 0; i < Math.min(trace.length, 10); i++) {
      const s = trace[i];
      this.logger.log(
        `#${i.toString().padStart(3, ' ')} pc=${s.pc
          .toString()
          .padStart(4, ' ')} op=${s.opcode.padEnd(12, ' ')} gas=${s.gas}`,
      );
    }

    env = {
      contractAddress,
      runtimeBytecode,
      creationBytecode,
      runtimeDisasm,
      creationDisasm,
      trace,
      tx: txMeta as TxMeta,
      isCreationPhase: false,
    };

    this.logger.log(
      `Executing scripts: ${scripts.map((s) => s.id).join(', ')}`,
    );

    const output = await this.scriptRunner.runForTx(env, scripts);

    this.logger.log('Script results:');
    console.dir(output.scripts, { depth: null });

    this.logger.log(`Views count: ${output.views.length}`);
    this.logger.log(`Marks count: ${output.marks.length}`);
    this.logger.log(`Snapshots count: ${output.snapshots.length}`);
  }
}
