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
    const artifact = JSON.parse(jsonRaw);

    const creationBytecode = this.extractBytecode(artifact.bytecode);
    const runtimeBytecode  = this.extractBytecode(artifact.deployedBytecode);

    if (!runtimeBytecode) {
      throw new Error('JSON artifact has no deployedBytecode (neither string nor object.object).');
    }

    let contractAddress: string | undefined;

    if (creationBytecode) {
      contractAddress = await this.deployRaw(creationBytecode);
    } else {
      this.logger.warn('No creation bytecode found in artifact, skipping deploy');
    }

    return {
      contractAddress,
      runtimeBytecode,
    };
  }

  /**
   * Режим: нам дали только runtimeBytecode (0x...).
   * Оборачиваем его в минимальный init-код и деплоим в anvil.
   */
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
      // В качестве "истины" по-прежнему считаем тот runtime, который нам дали
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
    });

    const receipt = await tx.wait();
    if (!receipt || !receipt.contractAddress) {
      throw new Error('Deploy failed, no contractAddress in receipt');
    }

    this.logger.log(`Deployed at: ${receipt.contractAddress}`);

    return receipt.contractAddress;
  }

  /**
   * Оборачиваем runtime-код в минимальный init-code:
   * PUSH2 <len> PUSH1 0x00 PUSH2 0x000f CODECOPY PUSH2 <len> PUSH1 0x00 RETURN <runtime>
   * Префикс фиксированно 15 байт, поэтому offset = 0x000f.
   */
  private wrapRuntimeIntoCreation(runtimeBytecode: string): string {
    const rt = runtimeBytecode.startsWith('0x')
      ? runtimeBytecode.slice(2)
      : runtimeBytecode;

    if (rt.length % 2 !== 0) {
      throw new Error('Invalid runtime bytecode: odd hex length');
    }

    const len = rt.length / 2; // bytes
    const lenHex = len.toString(16).padStart(4, '0'); // always PUSH2
    const offsetHex = '000f'; // fixed prefix length = 15 bytes

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
      rt; // <runtime>

    this.logger.log(
      `Wrapped runtime into creation: runtimeLen=${len} bytes, initLen=${init.length / 2} bytes`,
    );

    return init;
  }

  private extractBytecode(value: any): string | undefined {
    if (!value) return undefined;

    // Foundry / raw hex
    if (typeof value === 'string') {
      return value.startsWith('0x') ? value : '0x' + value;
    }

    // Hardhat format:
    // bytecode: { object: "...", sourceMap: "...", linkReferences: {...} }
    if (typeof value === 'object' && typeof value.object === 'string') {
      return value.object.startsWith('0x')
        ? value.object
        : '0x' + value.object;
    }

    return undefined;
  }
}
