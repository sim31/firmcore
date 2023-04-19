import { IFirmCore } from './ifirmcore';
import { FirmCore } from './firmcore-network-mock/firmcore';

const _firmcore = new FirmCore();

export default _firmcore as IFirmCore;
