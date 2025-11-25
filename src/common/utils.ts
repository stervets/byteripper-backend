import { randomBytes } from 'crypto';

export function genId(){
  return randomBytes(32).toString('hex');
}

export const timeout = (delay: number = 0) => {
  return new Promise((resolve) => {
    setTimeout(resolve, delay);
  });
}