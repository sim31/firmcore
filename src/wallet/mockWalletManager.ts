import { Wallet as EthWallet, utils } from 'ethers';
import { Address, IWallet, IWalletCreator, IWalletManager, PublicKey, Signature } from '../iwallet';
import { Wallet } from './wallet';
import { WalletCreator } from './walletCreator';

const _wallets: Wallet[] = [
  new Wallet(EthWallet.fromMnemonic(
    "citizen buffalo derive float trim rib vote typical forget fun wire mixture"
  )),
  new Wallet(EthWallet.fromMnemonic(
    "bless brown oyster gorilla rely very blind collect elite nurse plate require"
  )),
  new Wallet(EthWallet.fromMnemonic(
    "whip feel inch cement sunset regular happy educate casino trip interest energy"
  )),
  new Wallet(EthWallet.fromMnemonic(
    "comic skin fall industry execute weird taste half spawn moral demand keen"
  )),
  new Wallet(EthWallet.fromMnemonic(
    "save squeeze verb lazy holiday nose way old odor crunch yard toe"
  )),
  new Wallet(EthWallet.fromMnemonic(
    "situate decorate insect benefit trip torch sure bracket spray live way fish"
  )),
];
const _byAddress: Record<Address, Wallet> = _wallets.reduce((prevValue, wallet) => {
  return {
    ...prevValue,
    [wallet.getAddress()]: wallet
  };
}, {});

export class WalletManager implements IWalletManager {
  private _creator = new WalletCreator();

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
}