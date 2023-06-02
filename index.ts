import { IFirmCore } from './src/ifirmcore/index.js';
import { FirmCore } from './src/firmcore-network-mock/firmcore.js';
import { FirmcoreManager } from './src/firmcore-manager/index.js';
import { FilesTagger } from './src/files-tagger/index.js';

const _tagger = new FilesTagger();
const _fcManager = new FirmcoreManager(_tagger, FirmCore);

export default _fcManager;

export * from './src/ifirmcore/index.js';
export * from './src/firmcore-manager/index.js';
export * from './src/files-tagger/index.js';

// export default _firmcore as IFirmCore;

export * from './src/iwallet/index.js';
export type Address = string;

import { WalletManager } from './src/wallet/index.js';
import { IWalletManager } from './src/iwallet/index.js';
import { BrowserWalletManager } from './src/wallet/browserWallet.js';

export const walletManager = new BrowserWalletManager();
