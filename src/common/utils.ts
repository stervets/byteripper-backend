import { randomBytes } from 'crypto';

export function genId(){
  return randomBytes(32).toString('hex');
}

export const timeout = (delay: number = 0) => {
  return new Promise((resolve) => {
    setTimeout(resolve, delay);
  });
}

export function safeStringify(value: any){
  return JSON.stringify(value, (_, v) => {
    if (typeof v === 'bigint') return v.toString();
    if (typeof v === 'function') return undefined;
    return v;
  })
}

export function safeDeepClone<T = any>(value: T): T {
  return JSON.parse(safeStringify(value));
}