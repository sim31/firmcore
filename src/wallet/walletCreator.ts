import type { IWalletCreator, IWallet } from "../iwallet";
import { Wallet } from './wallet';
import { Wallet as EthWallet } from 'ethers';

export class WalletCreator implements IWalletCreator {
  newWallet(): Promise<IWallet> {
    return new Promise((resolve) => {
      resolve(new Wallet(EthWallet.createRandom()));
    });
  }
}
