import chai from 'chai';
import { firmcore as _firmcore, walletManager as _walletManager } from './hooks';
import chaiAsPromised from 'chai-as-promised';
import chaiSubset from 'chai-subset';
import { IFirmCore, EFConstructorArgs, newAccountWithAddress, newEFConstructorArgs, EFChain, AccountWithAddress, EFBlock } from '../src/ifirmcore';
import { IWallet, IWalletCreator, IWalletManager } from '../src/iwallet';
import { time } from 'console';
import { sleep } from './helpers';

chai.use(chaiAsPromised);
const expect = chai.expect;
chai.use(chaiSubset);

let firmcore: IFirmCore;
let walletManager: IWalletManager;
let newWallet: () => Promise<IWallet>;

describe("FirmCore", function () {
  before("Initialization", async function() {
    expect(_firmcore).to.not.be.undefined;
    expect(_walletManager).to.not.be.undefined;
    firmcore = _firmcore!;
    walletManager = _walletManager!;
    newWallet = () => {
      return walletManager.getCreator().newWallet();
    }

    await expect(firmcore.init()).to.be.fulfilled;
  });
  
  let chain: EFChain;
  let constructorArgs: EFConstructorArgs;
  const wallets: IWallet[] = []
  const accounts: AccountWithAddress[] = []
  let creationDate: Date;
  before("Create a EdenPlusFractal chain", async function() {
    for (let i = 0; i < 6; i++) {
      const w = await newWallet();
      wallets.push(w);
      accounts.push(newAccountWithAddress(
        { platform1: `p1a${i}`},
        w.getAddress(),
        `A${i}`,
      ));
    }

    creationDate = new Date();
    constructorArgs = newEFConstructorArgs(
      accounts,
      "Chain1",
      "CH1",
    );

    const chPromise = firmcore.createEFChain(constructorArgs);
    await expect(chPromise).to.be.fulfilled;
    chain = await chPromise;
  });

  after("Shutdown", async function() {
    await expect(firmcore.shutDown()).to.be.fulfilled;
  });

  describe("Initialization", function () {
    it('should not allow running init() twice', async function() {
      await expect(firmcore.init()).to.be.rejected;
    });
  });

  describe("createEFChain", function() {
    before(async function() {
    });

    it("should set the name", function() {
      expect(chain.name).to.be.equal("Chain1");
    });

    it("should set the symbol", function() {
      expect(chain.symbol).to.be.equal("CH1");
    });

    it("should set constructor args", function() {
      expect(chain.constructorArgs).to.deep.equal(constructorArgs);
    });
    
    it("should have genesisBlock equal headBlock", function() {
      expect(chain.genesisBlockId).to.deep.equal(chain.headBlockId);
    });
    
  });

  describe("getChain", function() {
    it("should return undefined for zero address", async function() {
      await expect(firmcore.getChain(firmcore.NullAddr)).to.eventually.be.undefined;
    })
    it("should return undefined for random address", async function() {
      const addr = firmcore.randomAddress();
      await expect(firmcore.getChain(addr)).to.eventually.be.undefined;
    });

    it("should retrieve the same chain", async function() {
      const promise = firmcore.getChain(chain.address);
      await expect(promise).to.be.fulfilled;
      const retrievedChain = await promise;
      expect(retrievedChain).to.containSubset({
        constructorArgs,
        name: constructorArgs.name,
        symbol: constructorArgs.symbol,
        genesisBlockId: chain.genesisBlockId,
        headBlockId: chain.headBlockId,
        address: chain.address,
      });
    });
  });

  describe("EFChain", function() {
    // prevBlockId, recentts, expected height, specified msgs
    describe("EFBlockBuilder", function() {
      let block1: EFBlock;
      before("create empty block", async function() {
        const builder = chain.builder;
        const promise1 = builder.createBlock(chain.headBlockId, []);
        expect(promise1).to.be.fulfilled;
        block1 = await promise1;
      });

      it("should set specified prevBlockId", function() {
        expect(block1.prevBlockId).to.be.equal(chain.headBlockId);
      });
      it("should set expected height", function() {
        expect(block1.height).to.be.equal(1);
      });
      it("should set recent enough timestamp", function() {
        const now = new Date();
        const minTime = new Date(creationDate.getTime() - 5000);
        expect(block1.timestamp).to.be.greaterThanOrEqual(minTime);
        expect(block1.timestamp).to.be.lessThan(now);
      });

      it("should set updateConfirmers message", async function() {
                
      })
    });

    describe("blockById", function() {
      it("should return undefined for zero block id", async function() {
        await expect(chain.blockById(firmcore.NullBlockId)).to.eventually.be.undefined;
      });
      it("should return undefined for random block id", async function() {
        await expect(chain.blockById(firmcore.randomBlockId())).to.eventually.be.undefined;
      });
      
      describe("genesis block", function() {
        let block: EFBlock;
        before("should be returned", async function() {
          const promise = chain.blockById(chain.genesisBlockId);
          await expect(promise).to.eventually.not.be.undefined;
          block = (await promise)!;
        });

        it("should have null for previous block id", function() {
          expect(block.prevBlockId).to.be.equal(firmcore.NullBlockId);
        });
        it("should have genesisBlockId of the chain", function() {
          expect(block.id).to.be.equal(chain.genesisBlockId);
        });
        it("should have a height of 0", function() {
          expect(block.height).to.be.equal(0);
        });
        it("should have a recent timestamp", function() {
          expect(block.timestamp).to.be.greaterThanOrEqual(creationDate);
          const maxTime = new Date(creationDate.getTime() + 10000); // +10s
          expect(block.timestamp).to.be.lessThan(maxTime);
        });
      })

      describe("next block", function() {
        let block1: EFBlock;
        let rBlock1: EFBlock;
        before("create a new block", async function() {
          const builder = chain.builder;
          const promise1 = builder.createBlock(chain.headBlockId, []);
          expect(promise1).to.be.fulfilled;
          block1 = await promise1;
        });
        before("should be returned", async function() {
          const promise1 = chain.blockById(block1.id);
          expect(promise1).to.eventually.be.not.undefined;
          rBlock1 = (await promise1)!;
        });

        it("should be the same as returned by createBlock", function() {
          expect(rBlock1).to.containSubset({
            id: block1.id,
            prevBlockId: block1.prevBlockId,
            height: block1.height,
            timestamp: block1.timestamp,
          });

        });
      });
    });
  });

  describe("EFBlockBuilder", function() {
    it("should create a block that changes confirmers", async function() {
            
    });
  });
});
