import chai from 'chai';
import { firmcore as _firmcore, walletManager as _walletManager } from './hooks';
import chaiAsPromised from 'chai-as-promised';
import chaiSubset from 'chai-subset';
import { IFirmCore, EFConstructorArgs, newAccountWithAddress, newEFConstructorArgs, EFChain, AccountWithAddress, EFBlock, ConfirmationStatus, AccountId, weekIndices, newAddConfirmerOp, newConfirmer, newRemoveConfirmerOp, BlockId, EFBlockPOD, ConfirmerOp, EFBreakoutResults, newEFBreakoutResults, newEFSubmitResultsMsg, newCreateAccountMsg, newAccount, newRemoveAccountMsg, newUpdateAccountMsg, newSetDirMsg, BlockConfirmer } from '../src/ifirmcore';
import { IWallet, IWalletCreator, IWalletManager } from '../src/iwallet';
import { sleep } from './helpers';
import InvalidArgument from '../src/exceptions/InvalidArgument';
import { updatedConfirmerMap, updatedConfirmerSet } from '../src/helpers/confirmerSet';

chai.use(chaiSubset);
chai.use(chaiAsPromised);
const expect = chai.expect;

let firmcore: IFirmCore;
let walletManager: IWalletManager;
let newWallet: () => Promise<IWallet>;

function expectedThreshold(confirmerCount: number) {
  return Math.ceil((confirmerCount * 2) / 3) + 1;
}

function confirmerCount(block: EFBlock) {
  return Object.values(block.state.confirmerSet.confirmers).length;
}

async function confirmAndExecute(block: EFBlock, confirmers: BlockConfirmer[]) {
  const potentialWeight = confirmerCount(block);
  const reqThreshold = expectedThreshold(potentialWeight);
  for (let i = 0; i < reqThreshold; i++) {
    await expect(confirmers[i]!.confirm(block.id)).to.be.fulfilled;
  }
}

describe("IFirmCore", function () {
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
    for (let i = 0; i < 10; i++) {
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

  let accountIds: AccountId[] = [];
  before("account ids should be known", async function() {
    for (const acc of constructorArgs.confirmers) {
      const rAcc = await genesisBl.state.accountByAddress(acc.address);
      expect(rAcc).to.not.be.undefined;
      accountIds.push(rAcc!.id);
    }
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
    
    it("should have genesisBlock equal headBlock", async function() {
      expect(chain.genesisBlockId).to.deep.equal(await chain.headBlockId());
    });

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
            const expThreshold = expectedThreshold(confCount);
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
          it("should return accounts specified in constructor args", async function() {
            for (let i = 0; i < accountIds.length; i++) {
              const promise = genesisBl.state.accountById(accountIds[i]!);
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
      let headId: BlockId;
      before("should know head block id", async function() {
        headId = await chain.headBlockId();
      });
      describe("empty block", function() {
        before("create empty block", async function() {
          const builder = chain.builder;
          const promise1 = builder.createBlock(headId, []);
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

          expect(await chain.headBlockId()).to.deep.equal(chain.genesisBlockId);
        });
        it("should set specified prevBlockId", async function() {
          expect(block1.prevBlockId).to.be.equal(await chain.headBlockId());
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
      });

      async function testCreateUpdateConfirmersMsg(prevBlockArg: BlockId | EFBlock | EFBlockPOD) {
        const confCount = confirmerCount(genesisBl);
        const expThreshold = expectedThreshold(confCount);
        expect(expThreshold)
          .to.be.equal(5)
          .and.to.be.equal(genesisBl.state.confirmerSet.threshold);

        const confOps1 = [
          newAddConfirmerOp(newConfirmer((await newWallet()).getAddress())),
          newAddConfirmerOp(newConfirmer((await newWallet()).getAddress())),
        ];
        const promise = chain.builder.createUpdateConfirmersMsg(
          prevBlockArg,
          confOps1,
        );
        await expect(promise).to.be.fulfilled;
        const msg = await promise;
        expect(msg.ops).to.deep.equal(confOps1);
        expect(msg.threshold).to.equal(expectedThreshold(confCount + 2));

        const confs = Object.values(genesisBl.state.confirmerSet.confirmers);
        const confOps2 = [
          newRemoveConfirmerOp(confs[0]!),
          newRemoveConfirmerOp(confs[1]!),
          newRemoveConfirmerOp(confs[2]!),
        ];
        const promise2 = chain.builder.createUpdateConfirmersMsg(
          prevBlockArg,
          confOps2,
        );
        await expect(promise2).to.be.fulfilled;
        const msg2 = await promise2;
        expect(msg2.ops).to.deep.equal(confOps2);
        expect(msg.threshold).to.equal(expectedThreshold(confCount - 2));

        const confOps3 = [
          newRemoveConfirmerOp(confs[3]!),
          newAddConfirmerOp(newConfirmer((await newWallet()).getAddress())),
        ];
        const promise3 = chain.builder.createUpdateConfirmersMsg(
          prevBlockArg,
          confOps3,
        );
        await expect(promise3).to.be.fulfilled;
        const msg3 = await promise3;
        expect(msg3.ops).to.deep.equal(confOps3);
        expect(msg.threshold).to.equal(expThreshold);
      }

      describe("createUpdateConfirmersMsg(prevBlock: BlockId)", function() {
        it("should return the same confirmerOps with adjusted threshold", async function() {
          testCreateUpdateConfirmersMsg(headId);
        });
      });

      describe("createUpdateConfirmersMsg(prevBlock: EFBlock)", function() {
        it("should return the same confirmerOps with adjusted threshold", async function() {
          const block = await chain.blockById(headId);
          expect(block).to.not.be.undefined;
          testCreateUpdateConfirmersMsg(block!);
        });
      });

      describe("createUpdateConfirmersMsg(prevBlock: EFBlockPOD)", function() {
        it("should return the same confirmerOps with adjusted threshold", async function() {
          const podChain = await chain.getPODChain();
          const headBlock = podChain.blocks[podChain.blocks.length-1];
          expect(headBlock).to.not.be.undefined;
          testCreateUpdateConfirmersMsg(headBlock!);
        });
      });

      describe("block with 1 updateConfirmers message", function() {
        it("should create a block with updateConfirmers message", async function() {
          const builder = chain.builder;
          const confs = Object.values(genesisBl.state.confirmerSet.confirmers);
          const confOps = [
            newRemoveConfirmerOp(confs[3]!),
            newAddConfirmerOp(newConfirmer((await newWallet()).getAddress())),
            newAddConfirmerOp(newConfirmer((await newWallet()).getAddress())),
            newAddConfirmerOp(newConfirmer((await newWallet()).getAddress())),
          ];
          const msg = await builder.createUpdateConfirmersMsg(headId, confOps);
          const promise1 = builder.createBlock(
            headId,
            [msg]
          );
          await expect(promise1).to.be.fulfilled;
          block1 = await promise1;

          expect(block1.msgs[0]).to.deep.equal(msg);
        });
        it("should have new confirmerSet set", async function() {
          const builder = chain.builder;
          const oldConfSet = genesisBl.state.confirmerSet;
          const confs = Object.values(oldConfSet.confirmers);
          const confOps = [
            newRemoveConfirmerOp(confs[3]!),
            newAddConfirmerOp(newConfirmer((await newWallet()).getAddress())),
            newAddConfirmerOp(newConfirmer((await newWallet()).getAddress())),
            newRemoveConfirmerOp(confs[2]!),
          ];
          const newConfirmerSet = updatedConfirmerSet(
            oldConfSet,
            confOps
          );

          const msg = await builder.createUpdateConfirmersMsg(headId, confOps);
          const promise1 = builder.createBlock(
            headId,
            [msg]
          );
          await expect(promise1).to.be.fulfilled;
          block1 = await promise1;

          expect(block1.state.confirmerSet).to.deep.equal(newConfirmerSet);
        });
      });

      describe("block with EFSubmitResults message", function() {
        it("should create a block with EFSubmitResults message", async function() {
          const builder = chain.builder;

          const results: EFBreakoutResults[] = [
            newEFBreakoutResults(accountIds[1]!, accountIds[2], accountIds[1], accountIds[0], accountIds[3], accountIds[4]),
            newEFBreakoutResults(accountIds[5]!, accountIds[6], accountIds[5], accountIds[7], accountIds[8], accountIds[9]),
          ] 

          const msg = newEFSubmitResultsMsg(results)
          const promise = builder.createBlock(
            headId,
            [msg],
          );
          await expect(promise).to.be.fulfilled;
          const block = await promise;

          expect(block.msgs[0]).to.deep.equal(msg);
        });
      });

      describe("block with CreateAccountMsg", function() {
        it("should create a block with CreateAccountMsg", async function() {
          const msg = newCreateAccountMsg(newAccount({ testPlatform: 'as' }));
          const promise = chain.builder.createBlock(headId, [msg]);
          await expect(promise).to.be.fulfilled;
          const block = await promise
          expect(block.msgs[0]).to.deep.equal(msg);
        });
      });

      describe("block with RemoveAccountMsg", function() {
        it("should create a block with RemoveAccountMsg", async function() {
          const msg = newRemoveAccountMsg(accountIds[0]!);
          const block = chain.builder.createBlock(headId, [msg]);
          expect(block.then((block) => block.msgs[0]))
            .to.eventually.deep.equal(msg);
        });
      });

      describe("block with UpdateAccountMsg", function() {
        it("should create a block with updateAccountMsg", async function() {
          const msg = newUpdateAccountMsg(accountIds[3]!, newAccount({ somePlatform: 'acc' }));
          const block = chain.builder.createBlock(headId, [msg]);
          expect(block.then(block => block.msgs[0]))
            .to.eventually.deep.equal(msg);
        });
      });

      describe("block with SetDirMsg", function() {
        it("should create a block with SetDirMsg", async function() {
          const msg = newSetDirMsg(firmcore.randomIPFSLink());
          const block = chain.builder.createBlock(headId, [msg]);
          expect(block.then(block => block.msgs[0]))
            .to.eventually.deep.equal(msg);
        });
      });

      describe("blocks with multiple messages", function() {
        it("should create a block with specified messages", async function() {
          const builder = chain.builder;
          const confs = Object.values(genesisBl.state.confirmerSet.confirmers);
          const confOps = [
            newRemoveConfirmerOp(confs[3]!),
            newAddConfirmerOp(newConfirmer((await newWallet()).getAddress())),
            newAddConfirmerOp(newConfirmer((await newWallet()).getAddress())),
            newAddConfirmerOp(newConfirmer((await newWallet()).getAddress())),
          ];
          const msgs = [
            await builder.createUpdateConfirmersMsg(headId, confOps),
            newSetDirMsg(firmcore.randomIPFSLink()),
            newRemoveAccountMsg(accountIds[6]!),
            newEFSubmitResultsMsg([
              newEFBreakoutResults(
                accountIds[0]!,
                accountIds[1], accountIds[2], accountIds[3], accountIds[4]
              ),
            ]),
          ];

          const promise = chain.builder.createBlock(headId, msgs);

          expect(promise.then(block => block.msgs)).to.eventually.deep.equal(msgs);
        });
      });
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
          const promise1 = builder.createBlock(await chain.headBlockId(), []);
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

  describe("createWalletConfirmer", function() {
    let blConfirmers: BlockConfirmer[] = [];
    
    it("should create BlockConfirmer(s)", async function() {
      for (const wallet of wallets) {
        blConfirmers.push(await firmcore.createWalletConfirmer(wallet));
      }
    });

    describe("BlockConfirmer", function() {
      describe("confirm", function() {
        let block: EFBlock;
        let prevBlockId: BlockId;
        before("block should be created", async function() {
          prevBlockId = await chain.headBlockId();
          const promise = chain.builder.createBlock(prevBlockId, 
            [newSetDirMsg(firmcore.randomIPFSLink())],
          );
          await expect(promise).to.be.fulfilled;
          block = await promise;
        });

        it("should record confirmations", async function() {
          await expect(block.state.confirmations())
            .to.eventually.be.empty;

          await expect(blConfirmers[0]!.confirm(block.id)).to.be.fulfilled;

          await expect(block.state.confirmations())
            .to.eventually.contain(blConfirmers[0]!.address);

          await expect(blConfirmers[1]!.confirm(block.id)).to.be.fulfilled;

          await expect(block.state.confirmations())
            .to.eventually.contain(blConfirmers[0]!.address)
            .and.to.contain(blConfirmers[1]!.address);
        });
        it("should not allow confirming the same block twice by the same confirmer", async function() {
          await expect(blConfirmers[2]!.confirm(block.id)).to.be.fulfilled;

          await expect(block.state.confirmations())
            .to.eventually.deep.equal(
              [blConfirmers[0]!.address, blConfirmers[1]!.address, blConfirmers[2]!.address],
            );

          await expect(blConfirmers[2]!.confirm(block.id)).to.be.rejected;
        });
        it("should update confirmation status", async function() {
          const oldStatus = await block.state.confirmationStatus();
          expect(oldStatus).to.containSubset({
            currentWeight: 3,
            final: false,
          });

          await expect(blConfirmers[3]!.confirm(block.id)).to.be.fulfilled;

          await expect(block.state.confirmationStatus())
            .to.eventually.deep.equal({ ...oldStatus, currentWeight: 4 });
        });
        // TODO: Tests for Byzantine behaviour?
        describe("finalization", function() {
          it("should finalize a block", async function() {
            const oldStatus = await block.state.confirmationStatus();
            expect(oldStatus).to.containSubset({
              currentWeight: 4,
              final: false,
            });

            const potentialWeight = confirmerCount(genesisBl);
            const reqThreshold = expectedThreshold(potentialWeight);
            for (let i = 4; i < reqThreshold; i++) {
              await expect(blConfirmers[i]!.confirm(block.id)).to.be.fulfilled;
            }

            await expect(block.state.confirmationStatus())
              .to.eventually.deep.equal({ 
                currentWeight: reqThreshold,
                potentialWeight,
                threshold: reqThreshold,
                final: true,
              });
          });
          it("should update headBlockId", async function() {
            await expect(chain.headBlockId())
              .to.eventually.be.equal(block.id);
          });
        })
      });

      describe("execution", function() {
        describe("SetDirMsg", function() {
          it("should change directoryId", async function() {
            let block: EFBlock;
            let ipfsLink = firmcore.randomIPFSLink();
            const promise = chain.builder.createBlock(
              await chain.headBlockId(), 
              [newSetDirMsg(ipfsLink)]
            );
            await expect(promise).to.be.fulfilled;
            block = await promise;

            await confirmAndExecute(block, blConfirmers);

            await expect(block.state.directoryId())
              .to.eventually.be.equal(ipfsLink);
          });
        });

        describe("CreateAccountMsg", function() {
          it("should add an account to state", async function() {
            const addr = (await newWallet()).getAddress();
            const acc = newAccount({ ipns: "AAA" }, addr);
            const block = await chain.builder.createBlock(
              await chain.headBlockId(),
              [newCreateAccountMsg(acc)]
            );

            await confirmAndExecute(block, blConfirmers);

            await expect(chain.headBlockId()).to.eventually.equal(block.id);

            expect(await block.state.accountByAddress(addr))
              .to.containSubset({ address: addr, extAccounts: acc.extAccounts });
          })
        });

        describe("RemoveAccountMsg", function() {
          it("should remove an account from state", async function() {
            const headBlockId = await chain.headBlockId();
            const headBlock = await chain.blockById(headBlockId);
            expect(await headBlock?.state.accountById(accountIds[0]!))
              .to.not.be.undefined;

            const block = await chain.builder.createBlock(
              headBlock!.id,
              [newRemoveAccountMsg(accountIds[0]!)],
            );

            await confirmAndExecute(block, blConfirmers);

            expect(await block.state.accountById(accountIds[0]!))
              .to.be.undefined;
            expect(await block.state.accountByAddress(wallets[0]!.getAddress()))
              .to.be.undefined;
          });
        });

        describe("UpdateAccountMsg", function() {
          it("should update account in state", async function() {
            const acc = accounts[0]!;
            const newAcc = { ...acc, name: "acc0", extAccounts: { platform1: "p2a"} };

            const block = await chain.builder.createBlock(
              await chain.headBlockId(),
              [newUpdateAccountMsg(accountIds[0]!, newAcc)],
            );

            await confirmAndExecute(block, blConfirmers);

            expect(await block.state.accountById(accountIds[0]!))
              .to.deep.equal({ ...newAcc, id: accountIds[0]! });
          });
        });

        describe("EFSubmitResultsMsg", function() {
          it("should set the delegates in state", async function() {
            const builder = chain.builder;

            const results: EFBreakoutResults[] = [
              newEFBreakoutResults(accountIds[2]!, accountIds[2], accountIds[1], accountIds[0], accountIds[3], accountIds[4]),
              newEFBreakoutResults(accountIds[3]!, accountIds[6], accountIds[5], accountIds[7], accountIds[8], accountIds[9]),
            ] 

            const msg = newEFSubmitResultsMsg(results)
            const promise = builder.createBlock(
              await chain.headBlockId(),
              [msg],
            );
            await expect(promise).to.be.fulfilled;
            const block = await promise;

            await confirmAndExecute(block, blConfirmers);

            expect(await block.state.delegate(0, 0)).to.be.equal(accountIds[2]!);
            expect(await block.state.delegate(0, 1)).to.be.equal(accountIds[3]!);
            expect(await block.state.delegates(0))
              .to.deep.equal([accountIds[2], accountIds[3]]);

          });
        });

        describe("UpdateConfirmersMsg", function() {
          it("should require different set of confirmations for the next block", async function() {
            const builder = chain.builder;
            const oldConfSet = genesisBl.state.confirmerSet;
            const confs = Object.values(oldConfSet.confirmers);
            const nWallet1 = await newWallet();
            const nWallet2 = await newWallet();
            const confOps = [
              newRemoveConfirmerOp(confs[3]!),
              newAddConfirmerOp(newConfirmer(nWallet1.getAddress())),
              newAddConfirmerOp(newConfirmer(nWallet2.getAddress())),
              newRemoveConfirmerOp(confs[2]!),
            ];

            const headId = await chain.headBlockId();
            const msg = await builder.createUpdateConfirmersMsg(headId, confOps);
            const block = await builder.createBlock(
              headId,
              [msg]
            );

            await confirmAndExecute(block, blConfirmers);
            
            expect(await chain.headBlockId()).to.be.equal(block.id);

            const block2 = await builder.createBlock(
              block.id,
              [newSetDirMsg(firmcore.randomIPFSLink())],
            );

            await confirmAndExecute(block2, blConfirmers);

            // Old block id (expected threshold of blConfirmers is not enough anymore)
            expect(await chain.headBlockId()).to.be.equal(block.id);

            const nConfirmer1 = await firmcore.createWalletConfirmer(nWallet1);
            const nConfirmer2 = await firmcore.createWalletConfirmer(nWallet2);
            await expect(nConfirmer1.confirm(block2.id)).to.be.fulfilled;
            await expect(nConfirmer2.confirm(block2.id)).to.be.fulfilled;

            // Now that we added confirmations from new confirmers, headBlockId should be updated
            expect(await chain.headBlockId()).to.be.equal(block2.id);
          });

        });

      });
    });


  });
});
