/* Базовые типы */

export interface RawByte {
  pc: number;
  byte: number;
}

export interface RawStructLog {
  pc: number;
  op: string;
  gas: number;
  gasCost: number;
  depth: number;
  stack?: string[];
  memory?: string[];
  storage?: Record<string, string>;
}

/*
export interface ContractJsonArtifact {
  abi?: any[];
  bytecode?: string;
  deployedBytecode?: string;
}
 */

export interface DeployResult {
  contractAddress?: string;
  runtimeBytecode: string;
  creationBytecode?: string;
}

export interface RawStructLog {
  pc: number;
  op: string;
  gas: number;
  gasCost: number;
  depth: number;
  stack?: string[];
  memory?: string[];
  storage?: Record<string, string>;
}

export interface TraceStep {
  pc: number;
  opcode: string;
  gas: number;
  gasCost: number;
  depth: number;
  stack: bigint[];
  rawMemory?: string[];
  rawStorage?: Record<string, string>;
}

export interface TraceResult {
  structLogs: RawStructLog[];
}

export interface TxMeta {
  hash: string;
  from: string;
  to?: string;
  value: bigint;
  gasUsed: bigint;
  status?: number;
  input: string;
  nonce: number;
  blockNumber?: number;

  contractAddress?: string; // для deploy-транзакций
  balanceBefore?: bigint;
  balanceAfter?: bigint;
}
