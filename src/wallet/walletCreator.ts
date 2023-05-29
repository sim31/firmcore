import type { IWalletCreator, IWallet } from "../iwallet/index.js";
import { Wallet } from './wallet.js';
import { Wallet as EthWallet } from 'ethers';

export class WalletCreator implements IWalletCreator {
  newWallet(): Promise<IWallet> {
    return new Promise((resolve) => {
      resolve(new Wallet(EthWallet.createRandom()));
    });
  }
}
