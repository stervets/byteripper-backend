// src/evm/evm.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { JsonRpcProvider, Wallet } from 'ethers';
import * as fs from 'fs/promises';
import { ContractJsonArtifact, DeployResult } from './types';

@Injectable()
export class EvmService {
  private readonly logger = new Logger(EvmService.name);
  private readonly provider: JsonRpcProvider;

  constructor() {
    const rpcUrl = process.env.RPC_URL ?? 'http://127.0.0.1:8545';
    this.provider = new JsonRpcProvider(rpcUrl);
  }

  async loadFromJsonAndMaybeDeploy(path: string): Promise<DeployResult> {
    const jsonRaw = await fs.readFile(path, 'utf8');
    const artifact = JSON.parse(jsonRaw) as ContractJsonArtifact;

    const creationBytecode =
      artifact.bytecode && artifact.bytecode !== '0x'
        ? artifact.bytecode
        : undefined;

    const runtimeBytecode =
      artifact.deployedBytecode && artifact.deployedBytecode !== '0x'
        ? artifact.deployedBytecode
        : undefined;

    if (!runtimeBytecode) {
      throw new Error('No deployedBytecode found in JSON artifact');
    }

    let contractAddress: string | undefined;

    if (creationBytecode) {
      contractAddress = await this.deployRaw(creationBytecode);
    } else {
      this.logger.warn('No creation bytecode in artifact, skipping deploy');
    }

    return {
      contractAddress,
      runtimeBytecode,
    };
  }

  /**
   * Режим: нам дали только runtimeBytecode (0x...)
   * Пока деплой не делаем — только анализируем байткод.
   * Позже можно будет добавить генерацию минимального init-кода.
   */
  async fromRuntimeOnly(runtimeBytecode: string): Promise<DeployResult> {
    const hex = runtimeBytecode.trim();
    if (!hex.startsWith('0x')) {
      throw new Error('Runtime bytecode must start with 0x');
    }

    this.logger.log('Runtime-only mode, no deployment will be performed (for now).');

    return {
      contractAddress: undefined,
      runtimeBytecode: hex,
    };
  }

  /** Простой деплой "сыраго" байткода в anvil */
  private async deployRaw(creationBytecode: string): Promise<string> {
    const pk =
      process.env.DEPLOYER_PK ??
      // дефолтный приватник из anvil/hardhat (для локальной дев-сети пофиг)
      '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

    const wallet = new Wallet(pk, this.provider);

    this.logger.log('Sending deploy tx...');
    const tx = await wallet.sendTransaction({
      data: creationBytecode,
      // gasLimit можно не ставить — anvil сам подберёт
    });

    const receipt = await tx.wait();
    if (!receipt || !receipt.contractAddress) {
      throw new Error('Deploy failed, no contractAddress in receipt');
    }

    this.logger.log(`Deployed at: ${receipt.contractAddress}`);

    return receipt.contractAddress;
  }
}
