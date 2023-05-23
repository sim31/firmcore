import { IFirmCore } from './src/ifirmcore';
import { FirmCoreFNode as FirmCore } from './src/firmcore-firmnode';

const _firmcore = new FirmCore(true, false);

export * from './src/ifirmcore';

export default _firmcore as IFirmCore;

export * from './src/iwallet';
export type Address = string;

import { WalletManager } from './src/wallet';
import { IWalletManager } from './src/iwallet';
import { BrowserWalletManager } from './src/wallet/browserWallet';

export const walletManager = new BrowserWalletManager();
