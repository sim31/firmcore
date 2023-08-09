import { IFirmCore } from './src/ifirmcore/index.js';
import { FirmCore } from './src/metamask-firmcore/firmcore.js';

const _firmcore = new FirmCore();

export * from './src/ifirmcore/index.js';

export default _firmcore as IFirmCore;

export * from './src/iwallet/index.js';
export type Address = string;

import { WalletManager } from './src/wallet/index.js';
import { IWalletManager } from './src/iwallet/index.js';
import { BrowserWalletManager } from './src/wallet/browserWallet.js';

export const walletManager = new BrowserWalletManager();
