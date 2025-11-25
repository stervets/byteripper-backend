// src/evm/evm.service.ts
import { Injectable, Logger } from '@nestjs/common';
import {
  JsonRpcProvider,
  TransactionReceipt,
  TransactionResponse,
} from 'ethers';
import * as fs from 'fs/promises';
import { DeployResult, TxMeta } from './types';
import { AccountService } from './account.service';
import { RunnerEnv } from '../scripts/types';
import { BytecodeService } from './bytecode.service';
import path from 'path';
import { ScriptLoaderService } from '../scripts/script-loader.service';
import { TraceService } from './trace.service';
import { ScriptRunnerService } from '../scripts/runner.service';

@Injectable()
export class EvmService {
  private readonly logger = new Logger(EvmService.name);

  public env: RunnerEnv | null = null;

  constructor(
    private readonly provider: JsonRpcProvider,
    private readonly accounts: AccountService,
    private readonly bytecode: BytecodeService,
    private readonly scriptLoader: ScriptLoaderService,
    private readonly traceService: TraceService,
    private readonly scriptRunner: ScriptRunnerService,
  ) {}

  async getBalance(addr: string): Promise<bigint> {
    return await this.provider.getBalance(addr);
  }

  private extractBytecode(value: any): string | undefined {
    if (!value) return undefined;

    if (typeof value === 'string') {
      return value.startsWith('0x') ? value : '0x' + value;
    }

    if (typeof value === 'object' && typeof value.object === 'string') {
      return value.object.startsWith('0x') ? value.object : '0x' + value.object;
    }

    return undefined;
  }

  async deployFromJson(path: string): Promise<DeployResult> {
    const artifactRaw = await fs.readFile(path, 'utf8');
    const artifactJson = JSON.parse(artifactRaw);

    const creationStr = this.extractBytecode(artifactJson.bytecode);
    const runtimeStr = this.extractBytecode(artifactJson.deployedBytecode);

    if (!runtimeStr) {
      throw new Error(
        'Artifact has no deployedBytecode (string or object.object)',
      );
    }

    // ⬇️ И ДАЛЬШЕ УЖЕ ТОЛЬКО СТРОКИ
    const creationBytecode: string = creationStr || '';
    const runtimeBytecode: string = runtimeStr;

    const { contractAddress, tx } = await this.deployRaw(creationBytecode);

    return {
      contractAddress,
      runtimeBytecode,
      creationBytecode,
      tx,
    };
  }

  async deployFromBytecode(targetPath: string): Promise<DeployResult> {
    const content = await fs.readFile(targetPath, 'utf8');
    const runtimeBytecode = content.trim();

    if (!runtimeBytecode.startsWith('0x')) {
      throw new Error('Runtime bytecode must start with 0x');
    }

    this.logger.log(
      'Runtime-only mode: wrapping into minimal creation bytecode and deploying...',
    );

    const creationBytecode = this.wrapRuntimeIntoCreation(runtimeBytecode);
    const { contractAddress, tx } = await this.deployRaw(creationBytecode);

    return {
      contractAddress,
      runtimeBytecode,
      creationBytecode,
      tx,
    };
  }

  private async waitForReceipt(hash: string) {
    while (true) {
      const receipt = await this.provider.getTransactionReceipt(hash);
      if (receipt) return receipt;
      await new Promise((res) => setTimeout(res, 100));
    }
  }

  private async deployRaw(
    creationBytecode: string,
  ): Promise<{ contractAddress: string; tx: TxMeta }> {
    await this.accounts.loadAccounts();
    const from = this.accounts.get(0);

    this.logger.log(`Deploying from ${from}...`);

    const txHash: string = await (this.provider as any).send(
      'eth_sendTransaction',
      [
        {
          from,
          data: creationBytecode,
        },
      ],
    );

    const receipt: TransactionReceipt = await this.waitForReceipt(txHash);

    if (!receipt.contractAddress) {
      throw new Error('Deploy failed: no contractAddress in receipt');
    }

    const tx: TransactionResponse | null =
      await this.provider.getTransaction(txHash);

    if (tx === null) {
      throw new Error(`deployRaw: TransactionResponse error. ${txHash}`);
    }

    const txMeta: TxMeta = {
      hash: tx.hash,
      from: tx.from!,
      to: tx.to ?? undefined,
      value: tx.value ? BigInt(tx.value.toString()) : 0n,
      gasUsed: BigInt(receipt.gasUsed.toString()),
      status: receipt.status ?? undefined,
      input: tx.data,
      nonce: tx.nonce,
      blockNumber: receipt.blockNumber ?? undefined,
      contractAddress: receipt.contractAddress ?? undefined,
    };

    this.logger.log(`Deployed at: ${receipt.contractAddress}`);

    return {
      contractAddress: receipt.contractAddress,
      tx: txMeta,
    };
  }

  /**
   * Простейшая транзакция на контракт:
   * - без calldata (просто дергаем fallback/receive или nothing)
   * - возвращаем txHash, чтобы потом прогнать debug_traceTransaction
   */
  async sendSimpleTx(to: string, fromIndex = 0): Promise<string> {
    await this.accounts.loadAccounts();
    const from = this.accounts.get(fromIndex);

    const txHash = await (this.provider as any).send('eth_sendTransaction', [
      {
        from,
        to,
      },
    ]);

    await this.waitForReceipt(txHash);
    return txHash;
  }

  private async getFromAccount(index = 0): Promise<{ from: string }> {
    await this.accounts.loadAccounts();
    const from = this.accounts.get(index);
    return { from };
  }

  async sendSimpleTxWithMeta(
    to: string,
    fromIndex = 0,
  ): Promise<{ txHash: string; txMeta: TxMeta }> {
    const { from } = await this.getFromAccount(fromIndex);

    this.logger.log(`Sending simple tx from ${from} to ${to} ...`);

    const txHash: string = await (this.provider as any).send(
      'eth_sendTransaction',
      [
        {
          from,
          to,
        },
      ],
    );

    const receipt = await this.waitForReceipt(txHash);
    const tx: TransactionResponse | null =
      await this.provider.getTransaction(txHash);

    if (tx === null) {
      throw new Error(
        `sendSimpleTxWithMeta: TransactionResponse error. ${txHash}`,
      );
    }

    const txMeta: TxMeta = {
      hash: tx.hash,
      from: tx.from!,
      to: tx.to ?? undefined,
      value: tx.value ? BigInt(tx.value.toString()) : 0n,
      gasUsed: BigInt(receipt.gasUsed.toString()),
      status: receipt.status ?? undefined,
      input: tx.data,
      nonce: tx.nonce,
      blockNumber: receipt.blockNumber ?? undefined,
      contractAddress: receipt.contractAddress ?? undefined,
    };

    return { txHash, txMeta };
  }

  private wrapRuntimeIntoCreation(runtimeBytecode: string): string {
    const rt = runtimeBytecode.startsWith('0x')
      ? runtimeBytecode.slice(2)
      : runtimeBytecode;

    if (rt.length % 2 !== 0) {
      throw new Error('Invalid runtime bytecode: odd hex length');
    }

    const len = rt.length / 2;
    const lenHex = len.toString(16).padStart(4, '0');
    const offsetHex = '000f';

    const init =
      '0x' +
      '61' +
      lenHex + // PUSH2 <len>
      '60' +
      '00' + // PUSH1 0x00
      '61' +
      offsetHex + // PUSH2 0x000f
      '39' + // CODECOPY
      '61' +
      lenHex + // PUSH2 <len>
      '60' +
      '00' + // PUSH1 0x00
      'f3' + // RETURN
      rt;

    this.logger.log(
      `Wrapped runtime into creation: runtimeLen=${len} bytes, initLen=${
        init.length / 2
      } bytes`,
    );

    return init;
  }

  async run(targetFile: string) {
    if (!targetFile) {
      this.logger.error('Usage: yarn dev <path-to-json-or-runtime-file>');
      return;
    }

    const targetPath = path.resolve(targetFile);
    this.logger.log(`Target: ${targetPath}`);

    const {contractAddress, runtimeBytecode, creationBytecode, tx} =
      path.extname(targetPath).toLowerCase() === '.json' ?
      await this.deployFromJson(targetPath) :
      await this.deployFromBytecode(targetFile);

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

    this.env = {
      contractAddress,
      runtimeBytecode,
      creationBytecode,
      runtimeDisasm,
      creationDisasm,
      trace: [],
      tx,
      isCreationPhase: true,
    };

    // грузим все скрипты (core + user)
    const scripts = await this.scriptLoader.loadAllScripts();
    const deployOutput = await this.scriptRunner.runOnDeploy(this.env, scripts);

    this.logger.log('Deploy-time script results:');
    console.dir(deployOutput.scripts, { depth: null, colors: true });

    return this.env;
  }
}
