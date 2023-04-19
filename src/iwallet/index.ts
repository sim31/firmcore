export type PublicKey = string;
export type Address = string;
export type Signature = string;

export interface IWallet {
  getAddress(): Address;
  getPublicKey(): PublicKey;
  sign(digest: string): Promise<string>;
}

export interface IWalletCreator {
  newWallet(): Promise<IWallet>;
}

export interface IWalletManager {
  getCreator(): IWalletCreator;
  getWallet(address: Address): Promise<IWallet | undefined>;
  // getWalletByPubKey(pubKey: PublicKey): Promise<IWallet>;
}
