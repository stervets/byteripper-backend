// src/evm/bytecode.service.ts
import { Injectable } from '@nestjs/common';
import { RawByte } from './types';

@Injectable()
export class BytecodeService {
  disassemble(runtimeBytecode: string): RawByte[] {
    const hex = runtimeBytecode.startsWith('0x')
      ? runtimeBytecode.slice(2)
      : runtimeBytecode;

    if (hex.length % 2 !== 0) {
      throw new Error('Invalid runtime bytecode: odd hex length');
    }

    const result: RawByte[] = [];
    let pc = 0;

    for (let i = 0; i < hex.length; i += 2) {
      const byteHex = hex.slice(i, i + 2);
      const byte = parseInt(byteHex, 16);
      result.push({ pc, byte });
      pc += 1;
    }

    return result;
  }
}
