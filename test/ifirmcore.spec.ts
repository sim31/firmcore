import chai from 'chai';
import { firmcore as _firmcore, walletManager as _walletManager } from './hooks';
import chaiAsPromised from 'chai-as-promised';
import chaiSubset from 'chai-subset';
import { IFirmCore, EFConstructorArgs, newAccountWithAddress, newEFConstructorArgs, EFChain, AccountWithAddress, EFBlock, ConfirmationStatus, AccountId, weekIndices } from '../src/ifirmcore';
import { IWallet, IWalletCreator, IWalletManager } from '../src/iwallet';
import { sleep } from './helpers';
import InvalidArgument from '../src/exceptions/InvalidArgument';

chai.use(chaiAsPromised);
const expect = chai.expect;
chai.use(chaiSubset);

let firmcore: IFirmCore;
let walletManager: IWalletManager;
let newWallet: () => Promise<IWallet>;

describe("FirmCore", function () {
  before("initialization should be done", async function() {
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
  before("EdenPlusFractal chain should be created", async function() {
    for (let i = 0; i < 6; i++) {
      const w = await newWallet();
      wallets.push(w);
      accounts.push(newAccountWithAddress(
        { platform1: `p1a${i}`},
        w.getAddress(),
        `A${i}`,
      ));
    }

    constructorArgs = newEFConstructorArgs(
      accounts,
      "Chain1",
      "CH1",
    );

    const chPromise = firmcore.createEFChain(constructorArgs);
    await expect(chPromise).to.be.fulfilled;
    chain = await chPromise;
  });

  let genesisBl: EFBlock;
  before("genesis block should be retrieved", async function() {
    const promise = chain.blockById(chain.genesisBlockId);
    await expect(promise).to.eventually.not.be.undefined;
    genesisBl = (await promise)!;
  });

  after("shutdown should be done", async function() {
    await expect(firmcore.shutDown()).to.be.fulfilled;
  });

  describe("init", function () {
    it('should not allow running init() twice', async function() {
      await expect(firmcore.init()).to.be.rejected;
    });
  });

  describe("createEFChain", function() {
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

    // TODO: Checks for the state
    describe("genesis block", function() {
      it("should have null for previous block id", function() {
        expect(genesisBl.prevBlockId).to.be.equal(firmcore.NullBlockId);
      });
      it("should have genesisBlockId of the chain", function() {
        expect(genesisBl.id).to.be.equal(chain.genesisBlockId);
      });
      it("should have a height of 0", function() {
        expect(genesisBl.height).to.be.equal(0);
      });
      it("should have a recent timestamp", function() {
        const now = new Date();
        expect(genesisBl.timestamp).to.be.lessThan(now);
        const minTime = new Date(now.getTime() - 60000); // -60s from now
        expect(genesisBl.timestamp).to.be.greaterThanOrEqual(minTime);
      });

      describe("state", function() {
        describe("confirmerSet", function() {
          it("should have accounts from constructorArgs and they should all have weight of 1", function() {
            for (const acc of accounts) {
              expect(genesisBl.state.confirmerSet.confirmers)
                .to.containSubset({
                  [acc.address]: { address: acc.address, weight: 1 }
                });
            }
          });
          it("should have a threshold of 2/3rds + 1 of confirmers", function() {
            const confSet = genesisBl.state.confirmerSet;
            const confCount = Object.values(confSet.confirmers).length;
            const expThreshold = Math.ceil((confCount * 2) / 3) + 1;
            expect(confSet.threshold).to.be.equal(expThreshold);
          });
        })
        
        describe("confirmations", function() {
          it("should have no confirmations", async function() {
            const promise = genesisBl.state.confirmations();
            await expect(promise).to.be.fulfilled;
            const confs = await promise;
            expect(confs).to.be.empty;
          });
        });

        describe("confirmationStatus", function() {
          let confStatus: ConfirmationStatus;
          before("confirmationStatus should be retrieved", async function() {
            const promise = genesisBl.state.confirmationStatus();
            await expect(promise).to.be.fulfilled;
            confStatus = await promise;
          });

          it("should be final", function() {
            expect(confStatus.final).to.be.true;
          });
        });

        describe("directoryId", function() {
          it("should return undefined", async function() {
            await expect(genesisBl.state.directoryId()).to.eventually.be.undefined;
          });
        });

        describe("accountByAddress", function() {
          // TODO: check that it does not contain any extra accounts?
          it("should return accounts specified in constructor args", async function() {
            for (const acc of constructorArgs.confirmers) {
              const promise = genesisBl.state.accountByAddress(acc.address);
              await expect(promise).to.eventually.not.be.undefined;
              const rAcc = (await promise)!;
              expect(rAcc).to.containSubset({ ...acc, id: rAcc.id });              
            }            
          });
        });

        describe("accountById", function() {
          let ids: AccountId[] = [];
          before("account ids should be known", async function() {
            for (const acc of constructorArgs.confirmers) {
              const rAcc = await genesisBl.state.accountByAddress(acc.address);
              expect(rAcc).to.not.be.undefined;
              ids.push(rAcc!.id);
            }
          });

          it("should return accounts specified in constructor args", async function() {
            for (let i = 0; i < ids.length; i++) {
              const promise = genesisBl.state.accountById(ids[i]!);
              await expect(promise).to.eventually.not.be.undefined;
              const rAcc = (await promise)!;
              expect(rAcc).to.containSubset({ ...accounts[i], id: rAcc.id });
            }
          });
        });

        describe("totalSupply", function() {
          it("should be zero", async function() {
            const promise = genesisBl.state.totalSupply();
            await expect(promise).to.eventually.be.equal(0);
          });
        });

        describe("delegates", function() {
          it("should return undefined for all weeks", async function() {
            for (const weekIndex of weekIndices) {
              await expect(genesisBl.state.delegates(weekIndex)).to.eventually.be.undefined;
            }
          });
        });

        describe("delegate", function() {
          it("should throw for all rooms in all weeks", async function() {
            for (const weekIndex of weekIndices) {
              for (let roomNumber = 0; roomNumber < 10; roomNumber++) {
                await expect(genesisBl.state.delegate(weekIndex, roomNumber))
                  .to.eventually.be.rejected;
              }
            }
          });
        });
      });
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

    it("should retrieve the created chain", async function() {
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
        await expect(promise1).to.be.fulfilled;
        block1 = await promise1;
      });

      it("should not change confirmer set", async function() {
        const promise = block1.state.confirmationStatus();
        await expect(promise).to.be.fulfilled;
        const confStatus = await promise;
        expect(confStatus).to.containSubset({
          threshold: genesisBl.state.confirmerSet.threshold,
        });

        const confSet = block1.state.confirmerSet;
        expect(confSet).to.deep.equal(genesisBl.state.confirmerSet);
      });
      it("should not have any confirmations in the beginning", async function() {
        const promise = block1.state.confirmationStatus();
        await expect(promise).to.be.fulfilled;
        const confStatus = await promise;
        const genesisBlSt = await genesisBl.state.confirmationStatus();
        expect(confStatus).to.containSubset({
          currentWeight: 0,
          final: false,
        });

        const promise2 = block1.state.confirmations();
        await expect(promise2).to.be.fulfilled;
        const confirmations = await promise2;
        expect(confirmations).to.be.empty;
      });
      it("should not extend the chain", async function() {
        const slice = await chain.getSlice();
        expect(slice).to.have.length(1);
        
        const podChain = await chain.getPODChain();
        expect(podChain.blocks).to.have.length(1);

        expect(chain.headBlockId).to.deep.equal(chain.genesisBlockId);
      });
      it("should set specified prevBlockId", function() {
        expect(block1.prevBlockId).to.be.equal(chain.headBlockId);
      });
      it("should set expected height", function() {
        expect(block1.height).to.be.equal(1);
      });
      it("should set recent enough timestamp", function() {
        const now = new Date();
        const minTime = new Date(now.getTime() - 5000);
        expect(block1.timestamp).to.be.lessThan(now);
        expect(block1.timestamp).to.be.greaterThanOrEqual(minTime);
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
      
      describe("next block", function() {
        let block1: EFBlock;
        let rBlock1: EFBlock;
        before("create a new block", async function() {
          const builder = chain.builder;
          const promise1 = builder.createBlock(chain.headBlockId, []);
          await expect(promise1).to.be.fulfilled;
          block1 = await promise1;
        });
        before("should be returned", async function() {
          const promise1 = chain.blockById(block1.id);
          await expect(promise1).to.eventually.be.not.undefined;
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
