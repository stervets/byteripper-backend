// src/evm/types.ts

export interface RawByte {
  pc: number;
  byte: number;
}

export interface ContractJsonArtifact {
  abi?: any[];
  bytecode?: string;
  deployedBytecode?: string;
}

export interface DeployResult {
  contractAddress?: string;
  runtimeBytecode: string;
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
  // пока без заморочек: memory и storage оставим "как есть",
  // потом уже сделаем нормальную нормализацию под ByteRipper
  rawMemory?: string[];
  rawStorage?: Record<string, string>;
}

export interface TraceResult {
  structLogs: RawStructLog[];
}
