// src/evm/types.ts

export interface RawByte {
  pc: number;
  byte: number;
}

export interface ContractJsonArtifact {
  abi?: any[];
  bytecode?: string;          // creation bytecode
  deployedBytecode?: string;  // runtime bytecode (как у Foundry/Hardhat)
}

export interface DeployResult {
  contractAddress?: string;   // может быть undefined, если деплой не делали
  runtimeBytecode: string;    // 0x...
}
