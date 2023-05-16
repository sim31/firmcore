import { Required } from 'utility-types';
import { AccountSystemImpl, AccountSystemImpl__factory, AccountValue, BlockIdStr, ConfirmerOpValue, EdenPlusFractal, EdenPlusFractal__factory, FirmChain, FirmChainAbi, FirmChainAbi__factory, FirmChainImpl, FirmChainImpl__factory, GenesisBlock, IPFSLink, Message, OptExtendedBlock, OptExtendedBlockValue, ZeroId, BreakoutResults, Signature, AddressStr } from "firmcontracts/interface/types";
import { IFirmCore, EFChain, EFConstructorArgs, Address, Account, BlockId, EFBlock, EFMsg, AccountId, ConfirmerSet, ConfirmerMap, EFBlockBuilder, BlockConfirmer, ConfirmerOpId, ConfirmerOp, ConfirmationStatus, toEFChainPODSlice, UpdateConfirmersMsg, AccountWithAddress, Confirmer, EFBlockPOD, EFChainState, getEFChainState, EFChainPODSlice, toEFBlockPOD, emptyDelegates, toValidSlots, ValidEFChainPOD, ValidSlots, NormEFChainPOD, normalizeSlots, NormalizedSlots } from "../ifirmcore";
import { BigNumber, BytesLike, ethers, utils } from "ethers";
import { createAddConfirmerOp, createGenesisBlockVal, createMsg, createUnsignedBlock, createUnsignedBlockVal, updatedConfirmerSet, } from "firmcontracts/interface/firmchain";
import { FirmContractDeployer } from 'firmcontracts/interface/deployer';
import { getBlockBodyId, getBlockDigest, getBlockId, normalizeHexStr, randomAddressHex, randomBytes32, randomBytes32Hex } from "firmcontracts/interface/abi";
import { ZeroAddr, ConfirmerSet as FcConfirmerSet  } from 'firmcontracts/interface/types';
import { timestampToDate } from '../helpers/date';
import OpNotSupprtedError from '../exceptions/OpNotSupported';
import ProgrammingError from '../exceptions/ProgrammingError';
import { IWallet } from '../iwallet';
import InvalidArgument from '../exceptions/InvalidArgument';
import NotFound from '../exceptions/NotFound';
import { Wallet } from "../wallet";
import assert from '../helpers/assert';
import { defaultThreshold, updatedConfirmerMap } from '../helpers/confirmerSet';
import { bytes32StrToCid0, cid0ToBytes32Str } from 'firmcontracts/interface/cid';

let abiLib: Promise<FirmChainAbi>;
let implLib: Promise<FirmChainImpl>;
let accSystemLib: Promise<AccountSystemImpl>;
let detFactoryAddr: Promise<string>;
let deployer: FirmContractDeployer;

let _verbose: boolean = false;
let _quiet: boolean = false;

interface Chain {
  contract: EdenPlusFractal;
  constructorArgs: EFConstructorArgs;
  genesisBlId: BlockIdStr;
  headBlockId: BlockIdStr;
}
const chains: Record<Address, Chain> = {};
const blocks: Record<BlockId, OptExtendedBlockValue> = {}
const blockNums: Record<BlockId, number> = {}
const orderedBlocks: Record<Address, BlockId[][]> = {};
const msgs: Record<BlockId, EFMsg[]> = {};
const fullAccounts: Record<IPFSLink, Account> = {};
const confirmations: Record<BlockId, Address[]> = {};
const states: Record<BlockId, EFChainState> = {};

const NullAccountId = 0;
const NullAccountAddr = ZeroAddr;

// let _underlyingProvider: ethers.providers.JsonRpcProvider | undefined;
let _provider: ethers.providers.JsonRpcProvider | undefined;
let _signer: ethers.providers.JsonRpcSigner | undefined;

function _storeAccount(account: Account) {
  const metadataId = randomBytes32Hex();
  fullAccounts[metadataId] = account;
  return metadataId;
}

async function _deployEFChain(
  fchainImpl: FirmChainImpl,
  accSystemImpl: AccountSystemImpl,
  args: Required<EFConstructorArgs, 'threshold'>,
) {
  assert(_signer, "Should have signer set already");
  const factory = new EdenPlusFractal__factory({
    ["contracts/FirmChainImpl.sol:FirmChainImpl"]: fchainImpl.address,
    ["contracts/AccountSystemImpl.sol:AccountSystemImpl"]: accSystemImpl.address,
  }, _signer);

  const confs: AccountValue[] = args.confirmers.map((conf) => {
    const metadataId = _storeAccount(conf);
    return {
      addr: conf.address,
      metadataId,
    }
  });
  const confOps = confs.map(conf => {
    return createAddConfirmerOp(conf.addr, 1);
  });

  const genesisBl = await createGenesisBlockVal([], ZeroId, confOps, args.threshold);

  const dtx = await factory.getDeployTransaction(
    genesisBl,
    confs,
    args.threshold,
    args.name, args.symbol,
  );
  const bytecode = dtx.data;
  assert(bytecode !== undefined, 'bytecode should be defined');
  const addr = await deployer.detDeployContract(bytecode ?? '', `${args.name} (EFChain)`);

  genesisBl.contract = addr;

  return { contract: factory.attach(addr), genesisBl };
}

async function _init(verbose: boolean = false, quiet: boolean = true) {
  _quiet = quiet;
  _verbose = verbose;
  // console.log("_init 1", !_ganacheProv, !_provider, !_signer);
  // assert(!_underlyingProvider && !_provider && !_signer, "Already initialized");
  assert(!_provider && !_signer, "Already initialized");
  _provider = new ethers.providers.JsonRpcProvider('http://localhost:60501');
  // _provider = new ethers.providers.Web3Provider(_underlyingProvider as any);
  _signer = _provider.getSigner(0);

  const signerBalance = await _signer!.getBalance();
  console.log('signer address: ', await _signer?.getAddress())
  console.log('signerBalance: ', signerBalance.toBigInt().toString());

  deployer = new FirmContractDeployer(_provider);
  await deployer.init();

  abiLib = deployer.deployAbi();
  const abiC = await abiLib;

  implLib = deployer.deployFirmChainImpl(abiC);

  accSystemLib = deployer.deployAccountSystemImpl();

}

async function _waitForInit() {
  return {
    abiLib: await abiLib,
    implLib: await implLib,
    accSystemLib: await accSystemLib,
  };
}

// TODO:
// * Take name of a contract function
async function _accessState<RetType>(chain: Chain, blockId: BlockId, f: () => Promise<RetType>): Promise<RetType> {
  const headId = await chain.contract.getHead();
  if (headId !== blockId) {
    throw new OpNotSupprtedError("Historical or future state access unsupported for now")
  } else {
    return await f();
  }
}

async function _getAccountById(chain: Chain, accountId: AccountId): Promise<Account | undefined> {
  const val = await chain.contract.getAccount(accountId);
  if (val.addr === NullAccountAddr) {
    return undefined;
  }

  const fullAccount = fullAccounts[val.metadataId];

  if (!fullAccount) {
    return {
      id: accountId,
      address: val.addr ? val.addr : undefined,
      extAccounts: {},
    }
  } else {
    return { ...fullAccount, id: accountId };
  }
}

function _confirmerSetFromBlock(block: OptExtendedBlockValue): ConfirmerSet {
  const blSet = block.state.confirmerSet;
  const confMap = blSet.confirmers.reduce((prevValue, conf) => {
    prevValue[conf.addr] = { address: conf.addr, weight: conf.weight };
    return prevValue;
  }, {} as ConfirmerMap);

  return {
    threshold: blSet.threshold,
    confirmers: confMap,
  };
}

function _confirmStatusFromBlock(prevBlock: OptExtendedBlockValue, confirms: Address[]): ConfirmationStatus {
  const blSet = prevBlock.state.confirmerSet;
  let weight = 0;
  let potentialWeight = 0;
  for (const conf of blSet.confirmers) {
    if (confirms.includes(conf.addr)) {
      weight += conf.weight;
    }
    potentialWeight += conf.weight;
  }

  return {
    threshold: blSet.threshold,
    currentWeight: weight,
    potentialWeight,
    final: weight >= blSet.threshold,
  };
}

function _confirmStatusForGenesis(): ConfirmationStatus {
  return {
    threshold: 0,
    currentWeight: 0,
    potentialWeight: 0,
    final: false,
  };
}

async function _signBlock(wallet: Wallet, block: OptExtendedBlockValue): Promise<Signature> {
  const digest = getBlockDigest(block.header);
  return await wallet.ethSign(digest);
}

function convertFcConfirmerSet(fcConfSet: FcConfirmerSet): ConfirmerSet {
  const confMap: ConfirmerMap = {};
  for (const conf of fcConfSet.confirmers) {
    confMap[conf.addr] = { address: conf.addr, weight: conf.weight };
  }
  return { confirmers: confMap, threshold: fcConfSet.threshold };
}

function _convertConfOpId(id: ConfirmerOpId): number {
  return id === 'add' ? 0 : 1;
}

function _convertConfirmerOp(op: ConfirmerOp): ConfirmerOpValue {
  return {
    opId: _convertConfOpId(op.opId),
    conf: {
      addr: op.confirmer.address,
      weight: op.confirmer.weight,
    }
  };
}

export class FirmCore implements IFirmCore {
  readonly NullAddr = ZeroAddr;
  readonly NullBlockId = ZeroId;
  readonly NullAccountId = NullAccountId;
  readonly NullIPFSLink = bytes32StrToCid0(ZeroId);

  private _verbose: boolean = false;
  private _quiet: boolean = true;

  constructor(verbose: boolean = false, quiet: boolean = true) {
    this._verbose = verbose;
    this._quiet = quiet;
  }

  async init(): Promise<void> {
    return await _init(this._verbose, this._quiet);
  }
  async shutDown(): Promise<void> {
  }
  async createWalletConfirmer(wallet: IWallet): Promise<BlockConfirmer> {
    let w: Wallet;
    if (!('ethSign' in wallet && '_wallet' in wallet && typeof wallet['ethSign'] === 'function')) {
      throw new OpNotSupprtedError("Wallet type unsupported");
    } else {
      w = (wallet as unknown) as Wallet;
    }
    return {
      address: wallet.getAddress(),
      confirm: async (blockId: BlockId) => {
        const block = blocks[blockId];        
        if (!block) {
          throw new NotFound("Block not found");
        }
        const prevBlock = blocks[utils.hexlify(block.header.prevBlockId)];
        const chain = chains[block.contract ?? 0];
        if (!chain) {
          throw new NotFound("Chain not found");
        }
        const blockNum = blockNums[blockId];
        if (blockNum === undefined) {
          throw new ProgrammingError("Block number not stored");
        }

        const ordBlocks = orderedBlocks[chain.contract.address];
        if (!ordBlocks || !ordBlocks[blockNum]) {
          throw new ProgrammingError("Block not saved into orderedBlocks index");
        }

        const signature = await _signBlock(w, block);

        await _provider?.send('evm_mine', []);

        const rValue = await chain.contract.callStatic.extConfirm(
          block.header,
          wallet.getAddress(),
          signature,
        );
        if (!rValue) {
          throw new Error("Contract returned false");
        }

        await _provider?.send('evm_mine', []);

        const tx = await chain.contract.extConfirm(
          block.header,
          wallet.getAddress(),
          signature,
        );
        // Will throw if tx fails
        await tx.wait()

        let bConfs = confirmations[blockId];

        if (!bConfs) {
          throw new ProgrammingError("Confirmations empty");
        }

        confirmations[blockId] = [...bConfs, wallet.getAddress()];
        bConfs = confirmations[blockId]!;
        const confirmStatus = prevBlock ? 
          _confirmStatusFromBlock(prevBlock, bConfs)
          : _confirmStatusForGenesis();
        if (confirmStatus.final) {
          // console.log("headBlock: ", await chain.contract.getHead());
          // console.log("getBlockId(block): ", getBlockId(block.header));
          await _provider?.send('evm_mine', []);
          await chain.contract.finalizeAndExecute(block);
          const head = await chain.contract.getHead();
          assert(head === blockId, "head of the chain should have been updated");
          // console.log("headBlock2: ", await chain.contract.getHead());
          // console.log("head: ", head);
          // console.log("blockId: ", blockId);
          chain.headBlockId = head;
          const ch = await this.getChain(chain.contract.address);
          assert(ch, "should be able to retrieve chain");
          const bl = await ch!.blockById(blockId);
          assert(bl, "should be able to retrieve EFBlock");
          states[blockId] = await getEFChainState(bl!);
        } else {
          // Update confirmation state
          states[blockId] = {
            delegates: emptyDelegates,
            directoryId: ZeroId,
            confirmations: bConfs,
            confirmationStatus: confirmStatus,
            confirmerSet: _confirmerSetFromBlock(block),
            allAccounts: false,
          }
        }
      }
    };
  }

  async createEFChain(args: EFConstructorArgs): Promise<EFChain> {
    // TODO: Construct EFConstructorArgsFull from args
    let nargs: Required<EFConstructorArgs, 'threshold'>;
    if (args.threshold) {
      if (Number.isNaN(args.threshold) || args.threshold <= 0) {
        throw new Error('Threshold has to be number > 0');
      }
      nargs = { ...args, threshold: args.threshold };
    } else {
      nargs = { ...args, threshold: defaultThreshold(args.confirmers) };
    }

    const cs = await _waitForInit();

    await _provider?.send('evm_mine', []);
    const { contract, genesisBl } = await _deployEFChain(cs.implLib, cs.accSystemLib, nargs);

    const bId = getBlockId(genesisBl.header);
    blocks[bId] = genesisBl;
    blockNums[bId] = 0;
    const ordBlocks: BlockId[][] = [[bId]];
    orderedBlocks[contract.address] = ordBlocks;
    msgs[bId] = [];
    confirmations[bId] = [];
    chains[contract.address] = {
      contract,
      constructorArgs: args,
      headBlockId: bId,
      genesisBlId: bId,
    };

    const chain = await this.getChain(contract.address);
    if (!chain) {
      throw new ProgrammingError("getChain returned undefined");
    } else {
      const genesisBl = await chain.blockById(chain.genesisBlockId);
      assert(genesisBl, "genesisBl should have been saved");
      states[bId] = await getEFChainState(genesisBl!);
      return chain;
    }
  }

  async getChain(address: Address): Promise<EFChain | undefined> {
    await _waitForInit();
    const chain = chains[address];
    if (!chain) {
      return undefined;
    }

    const blockById: (id: BlockId) => Promise<EFBlock | undefined> = async (id: BlockId) => {
      const block = blocks[id];
      const height = blockNums[id];
      const messages = msgs[id];
      // console.log("blockById 1: ", block, "\n", height, "\n", messages);
      if (!block || height === undefined || !messages) {
        return undefined;
      }

      return {
        id,
        prevBlockId: ethers.utils.hexlify(block.header.prevBlockId),
        height,
        timestamp: BigNumber.from(block.header.timestamp).toNumber(),
        msgs: messages, 
        state: {
          confirmerSet: _confirmerSetFromBlock(block),
          confirmations: () => {
            return new Promise((resolve) => {
              const confs = confirmations[id];
              if (confs) {
                resolve(confs);
              } else {
                resolve([]);
              }
            });
          },
          confirmationStatus: () => {
            return new Promise((resolve, reject) => {
              const confs = confirmations[id];
              if (!confs) {
                reject(new NotFound("Confirmation object not found"));
              } else {
                if (block.header.prevBlockId === ZeroId) {
                  // Means it's the first block
                  resolve({
                    currentWeight: 0,
                    potentialWeight: 0,
                    threshold: 0,
                    final: true,
                  });
                } else {
                  const prevBlock = blocks[utils.hexlify(block.header.prevBlockId)];
                  if (!prevBlock) {
                    reject(new ProgrammingError("Previous block not recorded"));
                  } else {
                    resolve(_confirmStatusFromBlock(prevBlock, confs));
                  }
                }
              }
            });
          },
          delegate: (weekIndex: number, roomNumber: number) => {
            return _accessState(chain, id, async () => {
              const bn = await chain.contract.getDelegate(weekIndex, roomNumber);
              const val = bn.toNumber();
              if (val === NullAccountId) {
                return undefined;
              } else {
                return val;
              }
            });
          },

          delegates: (weekIndex: number) => {
            return _accessState(chain, id, async () => {
              const bns = await chain.contract.getDelegates(weekIndex);
              const rVals = bns.map((bn) => bn.toNumber());
              if (rVals.length === 0) {
                return undefined;
              } else {
                return rVals
              }             
            })
          },

          balance: (accId: AccountId) => {
            return _accessState(chain, id, async () => {
              const bn = await chain.contract.balanceOfAccount(id);
              return bn.toNumber();
            });
          },

          balanceByAddr: (address: Address) => {
            return _accessState(chain, id, async () => {
              const bn = await chain.contract.balanceOf(address);
              return bn.toNumber();
            });
          }, 

          totalSupply: () => {
            return _accessState(chain, id, async () => {
              const bn = await chain.contract.totalSupply();
              return bn.toNumber();
            });
          },

          accountById: (accountId: AccountId) => {
            return _accessState(chain, id, async () => {
              return await _getAccountById(chain, accountId);
            });
          },

          accountByAddress: (address: Address) => {
            return _accessState(chain, id, async () => {
              const accountId = (await chain.contract.byAddress(address)).toNumber();
              if (accountId === NullAccountId) {
                return undefined;
              }
              return await _getAccountById(chain, accountId);
            });
          }, 

          directoryId: () => {
            return _accessState(chain, id, async () => {
              const dir = await chain.contract.getDir();
              if (dir === ZeroId) {
                return undefined;
              } else {
                const cid = bytes32StrToCid0(dir);
                return cid;
              }
            })
          }
        }
      }
    };

    const blockPODById = async (blockId: BlockId): Promise<EFBlockPOD | undefined> => {
      const bl = await blockById(blockId);
      const state = states[blockId];
      if (bl && state) {
        return {
          id: bl.id,
          prevBlockId: bl.prevBlockId,
          msgs: bl.msgs,
          timestamp: bl.timestamp,
          height: bl.height,
          state,
        }
      } else {
        return undefined;
      }
    }

    const builder: EFBlockBuilder = {
      createUpdateConfirmersMsg: async (
        prevBlock: BlockId | EFBlock | EFBlockPOD,
        confirmerOps: ConfirmerOp[],
      ): Promise<UpdateConfirmersMsg> => {
        let confMap: ConfirmerMap;
        if (typeof prevBlock === 'string') {
          const bl = blocks[prevBlock];          
          if (!bl) {
            throw new InvalidArgument("No block with this id");
          }

          const confSet = convertFcConfirmerSet(bl.state.confirmerSet);
          confMap = confSet.confirmers;
        } else {
          confMap = prevBlock.state.confirmerSet.confirmers;
        }

        const newMap = updatedConfirmerMap(confMap, confirmerOps);
        const newThreshold = defaultThreshold(Object.values(newMap))
        return {
          name: 'updateConfirmers',
          threshold: newThreshold,
          ops: confirmerOps,
        }
      },

      createBlock: async (prevBlockId: BlockId, messages: EFMsg[]): Promise<EFBlock> => {
        // TODO: Check if we have prevBlock
        const prevBlock = blocks[prevBlockId];
        const prevBlockNum = blockNums[prevBlockId];
        if (!prevBlock || (prevBlockNum === undefined)) {
          throw new NotFound("Previous block not found");
        }
        const chain = chains[prevBlock.contract ?? 0];
        if (!chain) {
          throw new NotFound("Chain not found");
        }

        const ordBlocks = orderedBlocks[chain.contract.address];
        if (!ordBlocks) {
          throw new NotFound("Blocks of the chain not found");
        }

        const serializedMsgs: Message[] = [];
        let confOps: ConfirmerOpValue[] | undefined;
        let newThreshold: number | undefined;

        for (const msg of messages) {
          if (msg.name === 'updateConfirmers') {
            if (newThreshold || confOps) {
              throw new InvalidArgument(
                "Unsupported operation: shouldn't update confirmers twice in the same block"
              );
            }

            newThreshold = msg.threshold;
            confOps = msg.ops.map((op) => _convertConfirmerOp(op));
          } else if (msg.name === 'createAccount') {
            const metadataId = _storeAccount(msg.account);
            const acc: AccountValue = {
              addr: msg.account.address ?? ZeroAddr,
              metadataId,
            };
            serializedMsgs.push(
              createMsg(chain.contract, 'createAccount', [acc])
            );
          } else if (msg.name === 'removeAccount') {
            serializedMsgs.push(
              createMsg(chain.contract, 'removeAccount', [msg.accountId])
            );
          } else if (msg.name === 'setDir') {
            const b32 = cid0ToBytes32Str(msg.dir);
            serializedMsgs.push(
              createMsg(chain.contract, 'setDir', [b32])
            );
          } else if (msg.name === 'updateAccount') {
            const metadataId = _storeAccount(msg.newAccount);
            const newAcc = {
              addr: msg.newAccount.address ?? ZeroAddr,
              metadataId,
            };
            serializedMsgs.push(
              createMsg(chain.contract, 'updateAccount', [msg.accountId, newAcc]),
            );
          } else if (msg.name === 'efSubmitResults') {
            const efResults: BreakoutResults[] = msg.results.map(res => {
              return {
                delegate: res.delegate ?? ZeroId,
                ranks: res.ranks.map(rank => rank ?? ZeroId),
              };
            });

            serializedMsgs.push(
              createMsg(chain.contract, 'submitResults', [efResults])
            );
          }
        }

        const block = await createUnsignedBlockVal(
          prevBlock, chain.contract, serializedMsgs,
          undefined, confOps, newThreshold
        );

        const bId = getBlockId(block.header);
        const blockNum = prevBlockNum + 1;
        blocks[bId] = block;
        blockNums[bId] = blockNum;
        msgs[bId] = messages;
        confirmations[bId] = [];
        const confSet = _confirmerSetFromBlock(block);
        const confirmStatus = _confirmStatusFromBlock(prevBlock, []);
        states[bId] = {
          delegates: emptyDelegates,
          directoryId: ZeroId,
          confirmations: [],
          confirmationStatus: confirmStatus,
          confirmerSet: confSet,
          allAccounts: false,
        }
        let slot = ordBlocks[blockNum];
        if (!slot) {
          slot = [];
          ordBlocks[blockNum] = slot;
        }
        slot.push(bId);

        // Construct EFBlock version of the block just created
        const efBlock = await blockById(bId);
        if (!efBlock) {
          throw new ProgrammingError("Unable to retrieve created block");
        }
        return efBlock;
      }
    }

    const getSlots = async (start?: number, end?: number) => {
      const ordBlocks = orderedBlocks[chain.contract.address];
      if (!ordBlocks) {
        throw new NotFound("Blocks for this chain not found");
      }

      const slice = ordBlocks.slice(start, end);

      const rSlice: EFBlock[][] = [];
      for (const slot of slice) {
        const newSlot = new Array<EFBlock>();
        rSlice.push(newSlot);
        for (const blockId of slot) {
          const bl = await blockById(blockId);
          if (!bl) {
            throw new ProgrammingError("Block id saved in orderedBlocks but not in blocks record");
          }
          newSlot.push(bl);
        }
      }
      return rSlice;
    }

    const getPODChain = async (start?: number, end?: number): Promise<EFChainPODSlice> => {
      const ordBlocks = orderedBlocks[chain.contract.address];
      if (!ordBlocks) {
        throw new NotFound("Blocks for this chain not found");
      }

      const slice = ordBlocks.slice(start, end);

      const rSlice: EFBlockPOD[][] = [];
      for (const slot of slice) {
        const newSlot = new Array<EFBlockPOD>();
        rSlice.push(newSlot);
        for (const blockId of slot) {
          const bl = await blockById(blockId);
          if (!bl) {
            throw new ProgrammingError("Block id saved in orderedBlocks but not in blocks record");
          }
          const state = states[blockId];
          assert(state, "State should have been saved");
          newSlot.push({
            state: state!,
            id: blockId,
            msgs: bl.msgs,
            height: bl.height,
            prevBlockId: bl.prevBlockId,
            timestamp: bl.timestamp,
          });
        }
      }

      return {
        constructorArgs: chain.constructorArgs,
        name: chain.constructorArgs.name,
        symbol: chain.constructorArgs.symbol,
        slots: rSlice,
        address: chain.contract.address,
        genesisBlockId: chain.genesisBlId,
      }
    }

    const getValidSlots = async (start?: number, end?: number): Promise<ValidSlots<EFBlock>> => {
      const slice = await getSlots(start, end);
      return toValidSlots(slice);
    };

    const getValidPODChain = async (start?: number, end?: number): Promise<ValidEFChainPOD> => {
      const podChain = await getPODChain(start, end);
      const slots = await toValidSlots(podChain.slots);
      return { ...podChain, slots };
    };

    const getNormalizedSlots = async (start?: number, end?: number): Promise<NormalizedSlots<EFBlock>> => {
      const validSlots = await getValidSlots(start, end);
      return normalizeSlots(validSlots);
    }

    const getNormPODChain = async (start?: number, end?: number): Promise<NormEFChainPOD> => {
      const validChain = await getValidPODChain(start, end);
      const slots = await normalizeSlots(validChain.slots);
      return { ...validChain, slots };
    };

    const efChain: EFChain = {
      builder,
      constructorArgs: chain.constructorArgs,
      blockById,
      blockPODById,
      getSlots,
      getValidSlots,
      getNormalizedSlots,
      getPODChain,
      getValidPODChain,
      getNormPODChain,
      name: chain.constructorArgs.name,
      symbol: chain.constructorArgs.symbol,
      address: chain.contract.address,
      genesisBlockId: chain.genesisBlId,
      headBlockId: () => chain.contract.getHead(),
    };

    return efChain;
  }

  randomAddress(): Address {
    return randomBytes32Hex();    
  }

  randomBlockId(): BlockId {
    return randomBytes32Hex();    
  }

  randomIPFSLink(): IPFSLink {
    return randomBytes32Hex();    
  }

}