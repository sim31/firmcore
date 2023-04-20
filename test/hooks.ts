import { IFirmCore } from "../src/ifirmcore";
import { FirmCore } from "../src/firmcore-network-mock/firmcore";

export let firmcore: IFirmCore | undefined;

export const mochaHooks = () => {
  // TODO: Select which firmcore implementation to load based on environment var
  // TODO: Allow customizing verbosity
  return {
    beforeAll: [
      function () {
        firmcore = new FirmCore();
      },
    ]
  };
};
