import { Injectable, Logger } from '@nestjs/common';
import { JsonRpcProvider } from 'ethers';

@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);
  private accounts: string[] = [];

  constructor(private readonly provider: JsonRpcProvider) {}

  async loadAccounts() {
    this.accounts = await (this.provider as any).send('eth_accounts', []);
    this.logger.log(`Loaded ${this.accounts.length} accounts from anvil`);
  }

  getAll() {
    return this.accounts;
  }

  get(index: number) {
    if (!this.accounts.length) {
      throw new Error('Accounts not loaded. Call loadAccounts() first.');
    }
    return this.accounts[index];
  }
}
