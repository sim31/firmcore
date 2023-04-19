import { Wallet as EthWallet, utils } from 'ethers';
import { Address, IWallet, IWalletCreator, IWalletManager, PublicKey, Signature } from '../iwallet';
import { Signature as EthSig } from 'firmcontracts/interface/types';


export class Wallet implements IWallet {
  private _wallet: EthWallet;

  constructor(w: EthWallet) {
    this._wallet = w;
  }

  getAddress(): Address {
    return this._wallet.address;
  }

  getPublicKey(): PublicKey {
    return this._wallet.publicKey;
  }

  sign(digest: string): Promise<Signature> {
    return new Promise((resolve) => {
      const sig = this._wallet._signingKey().signDigest(digest);
      resolve(Wallet.toGenericSig(sig));
    });
  }

  ethSign(digest: string): Promise<EthSig> {
    return new Promise((resolve) => {
      resolve(this._wallet._signingKey().signDigest(digest));
    });
  }

  static toGenericSig(ethSig: EthSig): Signature {
    const abiCoder = utils.defaultAbiCoder;
    return abiCoder.encode(
      ["bytes32", "bytes32", "uint8"],
      [ethSig.r, ethSig.s, ethSig.v],
    );
  }

  static fromGenericSig(sig: Signature): EthSig {
    const abiCoder = utils.defaultAbiCoder;
    const [r, s, v] = abiCoder.decode(
      ["bytes32", "bytes32", "uint8"],
      sig
    );
    return { r, s, v };
  }
}

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

export class WalletCreator implements IWalletCreator {
  newWallet(): Promise<IWallet> {
    return new Promise((resolve) => {
      resolve(new Wallet(EthWallet.createRandom()));
    });
  }
}

export class WalletManager implements IWalletManager {
  private _creator = new WalletCreator();

  getCreator(): IWalletCreator {
    return this._creator;
  }

  getWallet(address: Address): Promise<IWallet | undefined> {
    return new Promise((resolve) => { resolve(_byAddress[address]) });
  }
}
