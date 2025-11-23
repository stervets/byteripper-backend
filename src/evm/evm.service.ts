// src/evm/evm.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { JsonRpcProvider, TransactionResponse } from 'ethers';
import * as fs from 'fs/promises';
import { DeployResult, TxMeta } from './types';
import { AccountService } from './account.service';

@Injectable()
export class EvmService {
  private readonly logger = new Logger(EvmService.name);

  constructor(
    private readonly provider: JsonRpcProvider,
    private readonly accounts: AccountService,
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

  async loadFromJsonAndMaybeDeploy(path: string): Promise<DeployResult> {
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
    const creationBytecode: string | undefined = creationStr;
    const runtimeBytecode: string = runtimeStr;

    let contractAddress;
    if (creationBytecode) {
      contractAddress = await this.deployRaw(creationBytecode);
    }

    return {
      contractAddress,
      runtimeBytecode,
      creationBytecode
    };
  }

  async fromRuntimeOnly(runtimeBytecode: string): Promise<DeployResult> {
    const hex = runtimeBytecode.trim();
    if (!hex.startsWith('0x')) {
      throw new Error('Runtime bytecode must start with 0x');
    }

    this.logger.log(
      'Runtime-only mode: wrapping into minimal creation bytecode and deploying...',
    );

    const creationBytecode = this.wrapRuntimeIntoCreation(hex);
    const contractAddress = await this.deployRaw(creationBytecode);

    return {
      contractAddress,
      runtimeBytecode: hex,
      creationBytecode
    };
  }

  private async waitForReceipt(hash: string) {
    while (true) {
      const receipt = await this.provider.getTransactionReceipt(hash);
      if (receipt) return receipt;
      await new Promise((res) => setTimeout(res, 100));
    }
  }

  private async deployRaw(creationBytecode: string): Promise<string> {
    await this.accounts.loadAccounts();
    const from = this.accounts.get(0);

    this.logger.log(`Deploying from ${from}...`);

    const txHash = await (this.provider as any).send('eth_sendTransaction', [
      {
        from,
        data: creationBytecode,
      },
    ]);

    const receipt = await this.waitForReceipt(txHash);

    if (!receipt.contractAddress) {
      throw new Error('Deploy failed: no contractAddress in receipt');
    }

    this.logger.log(`Deployed at: ${receipt.contractAddress}`);
    return receipt.contractAddress;
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
    const tx: TransactionResponse | null = await this.provider.getTransaction(txHash);

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
}
