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

  encrypt(psw: string): Promise<string> {
    return this._wallet.encrypt(psw);
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

  static async decryptWallet(encrypted: string, psw: string): Promise<Wallet> {
    return new Wallet(await EthWallet.fromEncryptedJson(encrypted, psw));
  }
}