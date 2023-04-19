import chai from 'chai';
import { IFirmCore } from '../src/ifirmcore';
import { FirmCore } from '../src/firmcore-network-mock/firmcore';
import chaiAsPromised from 'chai-as-promised';

chai.use(chaiAsPromised);
const expect = chai.expect;

const firmcore = new FirmCore() as IFirmCore;

// TODO: Move these to a separate file and function and call for each implementation of firmcore

describe("FirmCore", function () {
  describe("Initialization", function () {
    it('should run init() without errors', async function() {
      return expect(firmcore.init()).to.eventually.be.fulfilled;
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
