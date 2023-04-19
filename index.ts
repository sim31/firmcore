import { IFirmCore } from './src/ifirmcore';
import { FirmCore } from './src/firmcore-network-mock/firmcore';

const _firmcore = new FirmCore();

export * from './src/ifirmcore';

export default _firmcore as IFirmCore;
