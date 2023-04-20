import chai from 'chai';
import { firmcore as _firmcore } from './hooks';
import chaiAsPromised from 'chai-as-promised';
import { IFirmCore } from '../src/ifirmcore';

chai.use(chaiAsPromised);
const expect = chai.expect;

let firmcore: IFirmCore;

// TODO: Move these to a separate file and function and call for each implementation of firmcore

describe("FirmCore", function () {
  before("Initialization", async function() {
    expect(_firmcore).to.not.be.undefined;
    firmcore = _firmcore!;

    await expect(firmcore.init()).to.be.fulfilled;
  });
  after("Shutdown", async function() {
    await expect(firmcore.shutDown()).to.be.fulfilled;
  });

  describe("Initialization", function () {
    it('should not allow running init() twice', async function() {
      await expect(firmcore.init()).to.be.rejected;
    });
  });
});

describe('Array', function () {
  describe('#indexOf()', function () {
    it('should return -1 when the value is not present', function () {
      expect([1, 2, 3].indexOf(4)).to.equal(-1);
    });
  });
});
