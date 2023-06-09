import { Required } from 'utility-types';
import { AccountSystemImpl, AccountValue, EdenPlusFractal__factory, FirmChainAbi, FirmChainImpl, OptExtendedBlockValue, ZeroAddr, ZeroId, ConfirmerSet as FcConfirmerSet, ConfirmerOpValue, AddressStr } from "firmcontracts/interface/types.js";
import { Account, AccountId, AccountWithAddress, Address, BlockConfirmer, BlockId, Chain, ConfirmationStatus, ConfirmerMap, ConfirmerOp, ConfirmerOpId, ConfirmerSet, EFChain, EFConstructorArgs, IFirmCore, IPFSLink } from "../ifirmcore/index.js";
import { bytes32StrToCid0, cid0ToBytes32Str } from "firmcontracts/interface/cid.js";
import { FirmContractDeployer } from "firmcontracts/interface/deployer.js";
import efBuild from 'firmcontracts/artifacts/contracts/EdenPlusFractal.sol/EdenPlusFractal.json';
import { createAddConfirmerOp, createGenesisBlockVal, createMsg, createUnsignedBlock, createUnsignedBlockVal, updatedConfirmerSet, } from "firmcontracts/interface/firmchain.js";
import { BigNumber, BytesLike, ethers, utils } from "ethers";
import assert from "../helpers/assert.js";
import { isDefined } from "../helpers/defined.js";
import { defaultThreshold } from '../helpers/confirmerSet.js';
import { FsEntries, anyToFile, createCARFile, getFileCID, getFileCIDBytes, getImportedCID, logTree, objectToFile, readCARFile } from '../helpers/car.js';
import { InvalidArgument } from '../exceptions/InvalidArgument.js';
import stringify from 'json-stable-stringify-without-jsonify';
import { OpNotSupprtedError}  from '../exceptions/OpNotSupported.js';
import { NotImplementedError } from '../exceptions/NotImplementedError.js';
import { Wallet } from '../wallet/index.js';
import { IWallet, Signature } from '../iwallet/index.js';
import { getBlockDigest, getBlockId, randomBytes32Hex } from 'firmcontracts/interface/abi.js';
import { NotFound } from '../exceptions/NotFound.js';
import { io } from 'socket.io-client';
import { ClientToServerEvents, CreatedContract, CreatedContractFull, FirmnodeSocket, ServerToClientEvents, isError, resIsAppliedTx } from './socketTypes.js';
import { CInputEncMsg, newCInputEncMsg, newFactoryInputDecMsg } from '../firmnode-base/message.js';
import { isLeft } from 'fp-ts/lib/Either.js';
import { FirmnodeBlockstore } from './blockstore.js';
import { exporter } from 'ipfs-unixfs-exporter';
import { CInputDecCodec, CInputEncCodec, FunctionArg } from '../firmnode-base/contractInput.js';
import { FirmnodeClient } from './firmnodeClient.js';

interface ChainIndex {
  blockById: Record<BlockId, IPFSLink>
}

interface ChainCache {
  belowCIDStr: IPFSLink,
  constructorArgs: EFConstructorArgs,
  index: ChainIndex,
}

export class FirmCoreFNode implements IFirmCore {
  readonly NullAddr = ZeroAddr;
  readonly NullBlockId = ZeroId;
  readonly NullAccountId = 0
  readonly NullAccountAddr = ZeroAddr;
  readonly NullIPFSLink = bytes32StrToCid0(ZeroId);

  private _verbose: boolean = false;
  private _quiet: boolean = true;

  private _abiLib: FirmChainAbi | undefined;
  private _implLib: FirmChainImpl | undefined;
  private _accSystemLib: AccountSystemImpl | undefined;
  private _deployer: FirmContractDeployer | undefined;

  private _provider: ethers.providers.JsonRpcProvider | undefined;
  private _signer: ethers.providers.JsonRpcSigner | undefined;

  private _ipfsEndpoint: string | undefined;

  private _socket: FirmnodeSocket | undefined;

  private _cache: Record<AddressStr, ChainCache> = {};

  private _fnClient: FirmnodeClient | undefined;

  constructor(verbose: boolean = false, quiet: boolean = true) {
    this._verbose = verbose;
    this._quiet = quiet;
  }

  async init(): Promise<void> {
    console.log('This is new version');
    // console.log("_init 1", !_ganacheProv, !_provider, !_signer);
    // assert(!_underlyingProvider && !_provider && !_signer, "Already initialized");
    assert(!this._provider && !this._signer && !this._socket, "Already initialized");
    this._provider = new ethers.providers.JsonRpcProvider('http://localhost:60501');
    // _provider = new ethers.providers.Web3Provider(_underlyingProvider as any);
    this._signer = this._provider.getSigner(0);

    this._socket = io('http://localhost:60500');

    const signerBalance = await this._signer!.getBalance();
    console.log('signer address: ', await this._signer?.getAddress())
    console.log('signerBalance: ', signerBalance.toBigInt().toString());

    this._deployer = new FirmContractDeployer(this._provider);
    await this._deployer.init();

    this._abiLib = await this._deployer.deployAbi();

    this._implLib = await this._deployer.deployFirmChainImpl(this._abiLib);

    this._accSystemLib = await this._deployer.deployAccountSystemImpl();

    this._ipfsEndpoint = 'http://localhost:8080'

    this._fnClient = new FirmnodeClient(this._socket);

    // await this._createCache('0xfb58bd38a11a4d94e902209110f4456c9eb0752c');
  }

  async shutDown(): Promise<void> {
  }

  isReady(): boolean {
    return isDefined([
      this._provider, this._signer, this._deployer,
      this._abiLib, this._implLib, this._accSystemLib,
      this._socket, this._fnClient
    ]);
  }

  _getInitialized() {
    assert(this.isReady(), 'firmcore must be initialized first');
    return {
      provider: this._provider!,
      signer: this._signer!,
      deployer: this._deployer!,
      abiLib: this._abiLib!,
      implLib: this._implLib!,
      accSystemLib: this._accSystemLib!,
      socket: this._socket!,
      ipfsEndpoint: this._ipfsEndpoint!,
      fnClient: this._fnClient!,
    }
  }

  private async _setChainCache(chainAddr: AddressStr, newCache: ChainCache) {
    this._cache[chainAddr] = newCache;
  }

  // TODO: optimize by not waiting until next value is asked for
  // private async * _fullChainDirIterator(cidStr: string) {
        
  // }

  private async _retrieveFullTree(ipfsEndpoint: string, cidStr: string) {
    const url = `${ipfsEndpoint}/ipfs/${cidStr}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/vnd.ipld.car'
      }
    });

    if (response.ok && response.body !== null) {
      return response.body;
    } else {
      throw new Error(`Could not retrieve: ${url}`);
    }
  }

  private async _createCache(chainAddr: AddressStr): Promise<ChainCache> {
    const { fnClient } = this._getInitialized();

    const deployment = await fnClient.readContractInputEnc(
      chainAddr, 'sc/deployment.json'
    );

    console.log('deployment: ', deployment);

    throw new NotImplementedError();
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

    const { provider, implLib, accSystemLib } = this._getInitialized();

    await provider.send('evm_mine', []);
    const { contract, genesisBl, deploymentCID, belowCIDStr } =
      await this._deployEFChain(implLib, accSystemLib, nargs);
    console.log('Contract created: ', contract.address);

    const newState: ChainCache = {
      belowCIDStr,
      constructorArgs: nargs,
      index: {
        blockById: {
          [getBlockId(genesisBl.header)]: deploymentCID
        }
      }
    };
    this._setChainCache(contract.address, newState);

    // await this._deployEFChain(implLib, accSystemLib, nargs);

    // const bId = getBlockId(genesisBl.header);
    // this._st.blocks[bId] = genesisBl;
    // this._st.blockNums[bId] = 0;
    // const ordBlocks: BlockId[][] = [[bId]];
    // this._st.orderedBlocks[contract.address] = ordBlocks;
    // this._st.msgs[bId] = [];
    // this._st.confirmations[bId] = [];
    // this._st.chains[contract.address] = {
    //   contract,
    //   constructorArgs: args,
    //   headBlockId: bId,
    //   genesisBlId: bId,
    // };

    const chain = await this.getChain(contract.address);

    throw new NotImplementedError();
    // if (!chain) {
    //   throw new ProgrammingError("getChain returned undefined");
    // } else {
    //   const genesisBl = await chain.blockById(chain.genesisBlockId);
    //   assert(genesisBl, "genesisBl should have been saved");
    //   this._st.states[bId] = await getEFChainState(genesisBl!);
    //   return chain;
    // }
  }

  async getChain(address: Address): Promise<EFChain | undefined> {
    this._getInitialized();

    const cache = this._cache[address];
    // await this._createCache(address);
    // if (cache === undefined) {
    //   // Need to build cache
    //   // Check if chain exists in firmnode
    //   await this._createCache(address);
    // }

    throw new NotImplementedError();
    // const chain = this._st.chains[address];
    // if (!chain) {
    //   return undefined;
    // }

    // const blockById: (id: BlockId) => Promise<EFBlock | undefined> = async (id: BlockId) => {
    //   const block = this._st.blocks[id];
    //   const height = this._st.blockNums[id];
    //   const messages = this._st.msgs[id];
    //   // console.log("blockById 1: ", block, "\n", height, "\n", messages);
    //   if (!block || height === undefined || !messages) {
    //     return undefined;
    //   }

    //   return {
    //     id,
    //     prevBlockId: ethers.utils.hexlify(block.header.prevBlockId),
    //     height,
    //     timestamp: BigNumber.from(block.header.timestamp).toNumber(),
    //     msgs: messages, 
    //     state: {
    //       confirmerSet: this._confirmerSetFromBlock(block),
    //       confirmations: () => {
    //         return new Promise((resolve) => {
    //           const confs = this._st.confirmations[id];
    //           if (confs) {
    //             resolve(confs);
    //           } else {
    //             resolve([]);
    //           }
    //         });
    //       },
    //       confirmationStatus: () => {
    //         return new Promise((resolve, reject) => {
    //           const confs = this._st.confirmations[id];
    //           if (!confs) {
    //             reject(new NotFound("Confirmation object not found"));
    //           } else {
    //             if (block.header.prevBlockId === ZeroId) {
    //               // Means it's the first block
    //               resolve({
    //                 currentWeight: 0,
    //                 potentialWeight: 0,
    //                 threshold: 0,
    //                 final: true,
    //               });
    //             } else {
    //               const prevBlock = this._st.blocks[utils.hexlify(block.header.prevBlockId)];
    //               if (!prevBlock) {
    //                 reject(new ProgrammingError("Previous block not recorded"));
    //               } else {
    //                 resolve(this._confirmStatusFromBlock(prevBlock, confs));
    //               }
    //             }
    //           }
    //         });
    //       },
    //       delegate: (weekIndex: number, roomNumber: number) => {
    //         return this._accessState(chain, id, async () => {
    //           const bn = await chain.contract.getDelegate(weekIndex, roomNumber);
    //           const val = bn.toNumber();
    //           if (val === this.NullAccountId) {
    //             return undefined;
    //           } else {
    //             return val;
    //           }
    //         });
    //       },

    //       delegates: (weekIndex: number) => {
    //         return this._accessState(chain, id, async () => {
    //           const bns = await chain.contract.getDelegates(weekIndex);
    //           const rVals = bns.map((bn) => bn.toNumber());
    //           if (rVals.length === 0) {
    //             return undefined;
    //           } else {
    //             return rVals
    //           }             
    //         })
    //       },

    //       balance: (accId: AccountId) => {
    //         return this._accessState(chain, id, async () => {
    //           const bn = await chain.contract.balanceOfAccount(id);
    //           return bn.toNumber();
    //         });
    //       },

    //       balanceByAddr: (address: Address) => {
    //         return this._accessState(chain, id, async () => {
    //           const bn = await chain.contract.balanceOf(address);
    //           return bn.toNumber();
    //         });
    //       }, 

    //       totalSupply: () => {
    //         return this._accessState(chain, id, async () => {
    //           const bn = await chain.contract.totalSupply();
    //           return bn.toNumber();
    //         });
    //       },

    //       accountById: (accountId: AccountId) => {
    //         return this._accessState(chain, id, async () => {
    //           return await this._getAccountById(chain, accountId);
    //         });
    //       },

    //       accountByAddress: (address: Address) => {
    //         return this._accessState(chain, id, async () => {
    //           const accountId = (await chain.contract.byAddress(address)).toNumber();
    //           if (accountId === this.NullAccountId) {
    //             return undefined;
    //           }
    //           return await this._getAccountById(chain, accountId);
    //         });
    //       }, 

    //       directoryId: () => {
    //         return this._accessState(chain, id, async () => {
    //           const dir = await chain.contract.getDir();
    //           if (dir === ZeroId) {
    //             return undefined;
    //           } else {
    //             const cid = bytes32StrToCid0(dir);
    //             return cid;
    //           }
    //         })
    //       }
    //     }
    //   }
    // };
  }

  private determineAccountPath(
    account: AccountWithAddress,
    entries: { path?: string }[]
  ): string {
    // Try to assign a name first
    if (account.name !== undefined) {
      const wantedPath = `accounts/${account.name}.json`;
      const existingName = entries.find(
        (entry) => entry.path === wantedPath
      );
      if (existingName === undefined) {
        return wantedPath;
      }
    }

    // Else assign address as a filename
    const wantedPath = `up/accounts/${account.address}.json`;
    const existing = entries.find(
      (entry) => entry.path === wantedPath
    );
    if (existing === undefined) {
      return wantedPath
    } else {
      throw new InvalidArgument('Multiple confirmers with the same address');
    }
  }

  private async _deployEFChain(
    fchainImpl: FirmChainImpl,
    accSystemImpl: AccountSystemImpl,
    args: Required<EFConstructorArgs, 'threshold'>,
  ) {
    const { deployer, socket, fnClient } = this._getInitialized();

    // Upload account metadata and abi files (our next transaction will reference these things)

    const abiFile = anyToFile(efBuild.abi);
    const fsEntries: FsEntries = [
      {
        ...abiFile,
        path: 'abi.json'
      },
      {
        path: 'accounts'
      },
    ];

    const confs: AccountValue[] = [];
    for (const account of args.confirmers) {
      const file = objectToFile(account);
      file.path = this.determineAccountPath(account, fsEntries);
      fsEntries.push(file);

      // Compute account structure for EVM as well
      const cidBytes = await getFileCIDBytes(file);
      confs.push({
        addr: account.address,
        metadataId: cidBytes
      })
    }


    const entries = await fnClient.importEntries(deployer.getFactoryAddress(), fsEntries);

    console.log("Imported entries: ", entries);

    const factory = new EdenPlusFractal__factory({
      ["contracts/FirmChainImpl.sol:FirmChainImpl"]: fchainImpl.address,
      ["contracts/AccountSystemImpl.sol:AccountSystemImpl"]: accSystemImpl.address,
    }, this._signer);

    const confOps = confs.map(conf => {
      return createAddConfirmerOp(conf.addr, 1);
    });

    const genesisBl = await createGenesisBlockVal([], confOps, args.threshold);
    console.log('genesis block: ', genesisBl);

    const abiCIDStr = getImportedCID(entries, 'abi.json').toString();
    const abiCIDBytes = cid0ToBytes32Str(abiCIDStr);

    const constrArgs: FunctionArg[] = [
      { name: 'genesisBl', value: genesisBl },
      { name: 'confirmers', value: confs },
      { name: 'threshold', value: args.threshold },
      { name: 'name_', value: args.name },
      { name: 'symbol_', value: args.symbol },
      { name: 'abiCID', value: abiCIDBytes }
    ];
    const inputMsg = newFactoryInputDecMsg(
      deployer.getFactoryAddress(),
      constrArgs, factory.bytecode,
      abiCIDStr,
    )

    const result = await fnClient.sendContractInput(inputMsg);
    const c = result.contractsCreated?.at(0);
    if (result.cidStr !== undefined && c !== undefined && c.belowCIDStr !== null) {
      return {
        contract: factory.attach(c.address),
        genesisBl,
        deploymentCID: result.cidStr,
        belowCIDStr: c.belowCIDStr,
      }
    } else {
      throw new Error(`Did not receive deployed address or deployment CID. ${inputMsg}`);
    }
  }

  // TODO:
  // * Take name of a contract function
  async _accessState<RetType>(chain: Chain, blockId: BlockId, f: () => Promise<RetType>): Promise<RetType> {
    throw new NotImplementedError();
    // const headId = await chain.contract.getHead();
    // if (headId !== blockId) {
    //   throw new OpNotSupprtedError("Historical or future state access unsupported for now")
    // } else {
    //   return await f();
    // }
  }

  async _getAccountById(chain: Chain, accountId: AccountId): Promise<Account | undefined> {
    throw new NotImplementedError();
    // const val = await chain.contract.getAccount(accountId);
    // if (val.addr === this.NullAccountAddr) {
    //   return undefined;
    // }

    // const fullAccount = this._st.fullAccounts[val.metadataId];

    // if (!fullAccount) {
    //   return {
    //     id: accountId,
    //     address: val.addr ? val.addr : undefined,
    //     extAccounts: {},
    //   }
    // } else {
    //   return { ...fullAccount, id: accountId };
    // }
  }

  _confirmerSetFromBlock(block: OptExtendedBlockValue): ConfirmerSet {
    throw new NotImplementedError();
    // const blSet = block.state.confirmerSet;
    // const confMap = blSet.confirmers.reduce((prevValue, conf) => {
    //   prevValue[conf.addr] = { address: conf.addr, weight: conf.weight };
    //   return prevValue;
    // }, {} as ConfirmerMap);

    // return {
    //   threshold: blSet.threshold,
    //   confirmers: confMap,
    // };
  }

  _confirmStatusFromBlock(prevBlock: OptExtendedBlockValue, confirms: Address[]): ConfirmationStatus {
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

  _confirmStatusForGenesis(): ConfirmationStatus {
    return {
      threshold: 0,
      currentWeight: 0,
      potentialWeight: 0,
      final: false,
    };
  }

  // FIXME: what wallet should it take?
  async _signBlock(wallet: Wallet, block: OptExtendedBlockValue): Promise<Signature> {
    throw new NotImplementedError();
    // const digest = getBlockDigest(block.header);
    // return await wallet.ethSign(digest);
  }

  convertFcConfirmerSet(fcConfSet: FcConfirmerSet): ConfirmerSet {
    const confMap: ConfirmerMap = {};
    for (const conf of fcConfSet.confirmers) {
      confMap[conf.addr] = { address: conf.addr, weight: conf.weight };
    }
    return { confirmers: confMap, threshold: fcConfSet.threshold };
  }

  _convertConfOpId(id: ConfirmerOpId): number {
    return id === 'add' ? 0 : 1;
  }

  _convertConfirmerOp(op: ConfirmerOp): ConfirmerOpValue {
    return {
      opId: this._convertConfOpId(op.opId),
      conf: {
        addr: op.confirmer.address,
        weight: op.confirmer.weight,
      }
    };
  }
  async createWalletConfirmer(wallet: IWallet): Promise<BlockConfirmer> {
    const { provider } = this._getInitialized();
    let w: Wallet;
    if (!('ethSign' in wallet && '_wallet' in wallet && typeof wallet['ethSign'] === 'function')) {
      throw new OpNotSupprtedError("Wallet type unsupported");
    } else {
      w = (wallet as unknown) as Wallet;
    }
    return {
      address: wallet.getAddress(),
      confirm: async (blockId: BlockId) => {
        throw new NotImplementedError();
        // const block = this._st.blocks[blockId];        
        // if (!block) {
        //   throw new NotFound("Block not found");
        // }
        // const prevBlock = this._st.blocks[utils.hexlify(block.header.prevBlockId)];
        // const chain = this._st.chains[block.contract ?? 0];
        // if (!chain) {
        //   throw new NotFound("Chain not found");
        // }
        // const blockNum = this._st.blockNums[blockId];
        // if (blockNum === undefined) {
        //   throw new ProgrammingError("Block number not stored");
        // }

        // const ordBlocks = this._st.orderedBlocks[chain.contract.address];
        // if (!ordBlocks || !ordBlocks[blockNum]) {
        //   throw new ProgrammingError("Block not saved into orderedBlocks index");
        // }

        // const signature = await this._signBlock(w, block);

        // await provider.send('evm_mine', []);

        // const rValue = await chain.contract.callStatic.extConfirm(
        //   block.header,
        //   wallet.getAddress(),
        //   signature,
        // );
        // if (!rValue) {
        //   throw new Error("Contract returned false");
        // }

        // await provider.send('evm_mine', []);

        // const tx = await chain.contract.extConfirm(
        //   block.header,
        //   wallet.getAddress(),
        //   signature,
        // );
        // // Will throw if tx fails
        // await tx.wait()

        // let bConfs = this._st.confirmations[blockId];

        // if (!bConfs) {
        //   throw new ProgrammingError("Confirmations empty");
        // }

        // this._st.confirmations[blockId] = [...bConfs, wallet.getAddress()];
        // bConfs = this._st.confirmations[blockId]!;
        // const confirmStatus = prevBlock ? 
        //   this._confirmStatusFromBlock(prevBlock, bConfs)
        //   : this._confirmStatusForGenesis();
        // if (confirmStatus.final) {
        //   // console.log("headBlock: ", await chain.contract.getHead());
        //   // console.log("getBlockId(block): ", getBlockId(block.header));
        //   await provider.send('evm_mine', []);
        //   await chain.contract.finalizeAndExecute(block);
        //   const head = await chain.contract.getHead();
        //   assert(head === blockId, "head of the chain should have been updated");
        //   // console.log("headBlock2: ", await chain.contract.getHead());
        //   // console.log("head: ", head);
        //   // console.log("blockId: ", blockId);
        //   chain.headBlockId = head;
        //   const ch = await this.getChain(chain.contract.address);
        //   assert(ch, "should be able to retrieve chain");
        //   const bl = await ch!.blockById(blockId);
        //   assert(bl, "should be able to retrieve EFBlock");
        //   this._st.states[blockId] = await getEFChainState(bl!);
        // } else {
        //   // Update confirmation state
        //   this._st.states[blockId] = {
        //     delegates: emptyDelegates,
        //     directoryId: ZeroId,
        //     confirmations: bConfs,
        //     confirmationStatus: confirmStatus,
        //     confirmerSet: this._confirmerSetFromBlock(block),
        //     allAccounts: false,
        //   }
        // }
      }
    };
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