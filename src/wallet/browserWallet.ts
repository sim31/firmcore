import { Address, IWallet, IWalletCreator, IWalletManager } from '../iwallet';
import { Wallet } from './wallet';
import { WalletCreator } from './walletCreator';

const _wallets: Wallet[] = [];
const _byAddress: Record<Address, Wallet> = _wallets.reduce((prevValue, wallet) => {
  return {
    ...prevValue,
    [wallet.getAddress()]: wallet
  };
}, {});


export class BrowserWalletCreator extends WalletCreator {
  async newWallet(): Promise<IWallet> {
    const wallet = await super.newWallet() as Wallet;
    _wallets.push(wallet);
    _byAddress[wallet.getAddress()] = wallet;
    return wallet;    
  }
}

export type WalletStatus = 'locked' | 'unlocked' | 'notCreated';

// FIXME: That's a terrible interface
export class BrowserWalletManager implements IWalletManager {
  private _creator = new BrowserWalletCreator();
  private _walletStatus: WalletStatus;

  constructor() {
    if (this.walletStored()) {
      this._walletStatus = 'locked';
    } else {
      this._walletStatus = 'notCreated';
    }
  }

  getCreator(): IWalletCreator {
    return this._creator;
  }

  getWallet(address: Address): Promise<IWallet | undefined> {
    return new Promise((resolve) => { resolve(_byAddress[address]) });
  }

  async getWalletAddressesAsync(): Promise<Address[]> {
    return _wallets.map(w => w.getAddress());
  }

  getWalletAddresses(): Address[] {
    return _wallets.map(w => w.getAddress());
  }

  async storeWallets(psw: string): Promise<void> {
    const encWallets: string[] = [];
    for (const wallet of _wallets) {
      encWallets.push(await wallet.encrypt(psw));
    }
    localStorage.setItem('wallets', JSON.stringify(encWallets));
    this._walletStatus = 'unlocked';
  }

  walletStored(): boolean {
    return localStorage.getItem('wallets') !== undefined;
  }

  getStatus(): WalletStatus {
    return this._walletStatus;
  }

  async unlock(psw: string) {
    const wltStore = localStorage.getItem('wallets');
    if (wltStore === null) {
      throw new Error('Wallet does not exist');
    }
    const wallets = JSON.parse(wltStore) as Array<string>;
    for (const encWlt of wallets) {
      const wlt = await Wallet.decryptWallet(encWlt, psw);
      if (wlt) {
        _wallets.push(wlt);
        _byAddress[wlt.getAddress()] = wlt;
      }
    }
    this._walletStatus = 'unlocked';
  }
}