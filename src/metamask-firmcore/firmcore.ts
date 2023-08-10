import { Overwrite, Required } from 'utility-types';
import { AccountSystemImpl, AccountSystemImpl__factory, AccountValue, BlockIdStr, ConfirmerOpValue, EdenPlusFractal, EdenPlusFractal__factory, FirmChain, FirmChainAbi, FirmChainAbi__factory, FirmChainImpl, FirmChainImpl__factory, GenesisBlock, IPFSLink, Message, OptExtendedBlock, OptExtendedBlockValue, ZeroId, BreakoutResults, Signature, AddressStr, SignatureValue, toValue, XEdenPlusFractal, XEdenPlusFractal__factory } from "firmcontracts/interface/types.js";
import { IFirmCore, EFChain, EFConstructorArgs, Address, Account, BlockId, EFBlock, EFMsg, AccountId, ConfirmerSet, ConfirmerMap, EFBlockBuilder, BlockConfirmer, ConfirmerOpId, ConfirmerOp, ConfirmationStatus, toEFChainPODSlice, UpdateConfirmersMsg, AccountWithAddress, Confirmer, EFBlockPOD, EFChainState, getEFChainState, EFChainPODSlice, toEFBlockPOD, emptyDelegates, toValidSlots, ValidEFChainPOD, ValidSlots, NormEFChainPOD, normalizeSlots, NormalizedSlots, Await, IMountedFirmCore, ChainNetworkInfo, MountPointChangedCb } from "../ifirmcore/index.js";
import { BigNumber, BytesLike, ethers, utils } from "ethers";
import { createAddConfirmerOp, createGenesisBlockVal, createMsg, createUnsignedBlock, createUnsignedBlockVal, updatedConfirmerSet, } from "firmcontracts/interface/firmchain.js";
import { FirmContractDeployer } from 'firmcontracts/interface/deployer.js';
import { getBlockBodyId, getBlockDigest, getBlockId, normalizeHexStr, randomAddressHex, randomBytes32, randomBytes32Hex } from "firmcontracts/interface/abi.js";
import { ZeroAddr, ConfirmerSet as FcConfirmerSet  } from 'firmcontracts/interface/types.js';
import { timestampToDate } from '../helpers/date.js';
import { OpNotSupprtedError } from '../exceptions/OpNotSupported.js';
import { ProgrammingError } from '../exceptions/ProgrammingError.js';
import { IWallet } from '../iwallet/index.js';
import { InvalidArgument } from '../exceptions/InvalidArgument.js';
import { NotFound } from '../exceptions/NotFound.js';
import { Wallet } from "../wallet/index.js";
import assert from '../helpers/assert.js';
import { defaultThreshold, updatedConfirmerMap } from '../helpers/confirmerSet.js';
import { bytes32StrToCid0, cid0ToBytes32Str } from 'firmcontracts/interface/cid.js';
import { isDefined } from '../helpers/defined.js';
import { CarFileInfo, FileOptions, MTime, anyToCAR, createCARFile, objectToCAR, objectToFile, readCARFile, unixfsFileToObj } from '../helpers/car.js';
import stringify from 'json-stable-stringify-without-jsonify';
import { FileCandidate } from 'ipfs-unixfs-importer';
import { MetaMaskSDK } from '@metamask/sdk';

interface Chain {
  contract: XEdenPlusFractal;
  constructorArgs: EFConstructorArgs;
  genesisBlId: BlockIdStr;
  headBlockId: BlockIdStr;
}
type SerializableChain = Overwrite<Chain, {
  contract: Address
}>;

type Confirmation = {
  address: Address
  sig: SignatureValue
}

// TODO: remove for serialization:
// * Chain.contract
interface FirmCoreState {
  chains: Record<Address, Chain>;
  blocks: Record<BlockId, OptExtendedBlockValue>;
  blockNums: Record<BlockId, number>;
  orderedBlocks: Record<Address, BlockId[][]>;
  msgs: Record<BlockId, EFMsg[]>;
  confirmations: Record<BlockId, Confirmation[]>;
  states: Record<BlockId, EFChainState>;
}

type SerializableFcState = Overwrite<FirmCoreState, {
  chains: SerializableChain[]
}>;

const initFirmCoreState: FirmCoreState = {
  chains: {},
  blocks: {},
  blockNums: {},
  orderedBlocks: {},
  msgs: {},
  confirmations: {},
  states: {},
}


export class FirmCore implements IMountedFirmCore {
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
  private _detFactoryAddr: string | undefined;
  private _deployer: FirmContractDeployer | undefined;

  private _provider: ethers.providers.JsonRpcProvider | undefined;
  private _signer: ethers.providers.JsonRpcSigner | undefined;

  private _mountpoint: ChainNetworkInfo | undefined;
  private _mpChangedCb: MountPointChangedCb | undefined;

  private _st: FirmCoreState;

  constructor(verbose: boolean = false, quiet: boolean = true) {
    this._verbose = verbose;
    this._quiet = quiet;

    this._st = JSON.parse(JSON.stringify(initFirmCoreState));
  }

  private _toSerializableFcState(): SerializableFcState {
    return { 
      ...this._st,
      chains: Object.values(this._st.chains).map((v) => {
        return {
          ...v,
          contract: v.contract.address
        }
      })
    };
  }

  private serializeFcState(options?: FileOptions): FileCandidate {
    const serializable = this._toSerializableFcState();
    return objectToFile(serializable, options);
  }

  async exportAsCAR(options?: FileOptions): Promise<CarFileInfo> {
    const file = this.serializeFcState(options);
    const car = await createCARFile([file], { wrapInDir: false });
    return car;
  }

  private async initFromCar(car: AsyncIterable<Uint8Array>) {
    const fsEntry = await readCARFile(car);            
    if (fsEntry.type !== 'file') {
      throw new Error('Single file expected');
    }
    const fcState = await unixfsFileToObj(fsEntry) as SerializableFcState;

    for (const chain of fcState.chains) {
      const constructorArgs = chain.constructorArgs;
      const genesisBl = fcState.blocks[chain.genesisBlId];
      if (genesisBl === undefined) {
        throw new InvalidArgument('Invalid car: chain.blocks does not contain genesis block');
      }
      const efChain = await this.createEFChain(constructorArgs, genesisBl);
      if (efChain.address !== chain.contract) {
        throw new InvalidArgument(`Invalid car: chain.contract: ${efChain.address} !== ${chain.contract}`);
      }
      if (efChain.genesisBlockId !== chain.genesisBlId) {
        throw new InvalidArgument('Invalid car: chain.genesisBlId')
      }

      const ordBlocks = fcState.orderedBlocks[chain.contract];
      if (ordBlocks !== undefined) {
        const genesisBlId = ordBlocks[0] ? ordBlocks[0][0] : undefined;
        if (genesisBlId === undefined) {
          throw new InvalidArgument('Invalid car: orderedBlocks missing genesis block');
        }
        if (genesisBlId !== efChain.genesisBlockId) {
          throw new InvalidArgument('Invalid car: orderedBlocks does not have the right genesis block');
        }

        const remainingBlocks = [
          [...ordBlocks[0]!.slice(1)],
          ...ordBlocks.slice(1)
        ]
        for (const slot of remainingBlocks) {
          for (const blockId of slot) {
            const block = fcState.blocks[blockId];
            if (block === undefined) {
              throw new InvalidArgument('Invalid car: referenced block not found');
            }
            const prevBlockId = block.header.prevBlockId;
            const msgs = fcState.msgs[blockId];
            if (msgs === undefined) {
              throw new InvalidArgument('Invalid car: messages for a block missing');
            }
            const bl = await this._createBlock(
              efChain.blockById,
              utils.hexlify(prevBlockId),
              msgs,
              block
            );
            if (bl.id !== getBlockId(block.header)) {
              throw new InvalidArgument('Invalid car: blocks id');
            }

            const confirmations = fcState.confirmations[bl.id];
            if (confirmations === undefined) {
              throw new InvalidArgument('Invalid car: confirmations should be defined');
            }
            for (const confirmation of confirmations) {
              await this.confirm(bl.id, confirmation);              
            }
          }
        }
      }
    }

    const carInfo = await this.exportAsCAR(fsEntry.unixfs);
    const ourCID = carInfo.rootCID.toV0().toString();
    const originalCID = fsEntry.cid.toV0().toString();
    if (ourCID !== originalCID) {
      throw new Error(`Initialization from CAR produced different CID than in the CAR ${ourCID} !== ${originalCID}`);
    }
  }

  // async mountCAR(carFile: Blob): Promise<void> {
  //   const fsEntry = await readCARFile(carFile.stream());            
  //   if (fsEntry.type !== 'file') {
  //     throw new Error('Single file expected');
  //   }
  //   const obj = await unixfsFileToObj(fsEntry);
  //   // TODO:
  //   // * relaunch ganache node

  //   this._st = obj;
  // }

  async _detectMountpoint(): Promise<void> {
    if (this._provider === undefined) {
      throw new ProgrammingError('Provider has to be retrieved before initializing chainpoint');
    }
    const network = await this._provider.detectNetwork();
    this._mountpoint = {
      name: network.name,
      chainId: network.chainId,
      id: `chainId: ${network.chainId}`,
      status: 'connected'
    }
    if (this._mpChangedCb) {
      this._mpChangedCb(this._mountpoint);
    }
  }

  onMountPointChanged(cb: MountPointChangedCb): void {
    this._mpChangedCb = cb;
  }

  getMountPoint(): ChainNetworkInfo {
    const { mountpoint } = this._getInitialized();
    return mountpoint;
  }

  async init(car?: AsyncIterable<Uint8Array>, noDeploy?: boolean): Promise<void> {
    // console.log("_init 1", !_ganacheProv, !_provider, !_signer);
    // assert(!_underlyingProvider && !_provider && !_signer, "Already initialized");
    // assert(!this._provider && !this._signer, "Already initialized");

    // this._provider = new ethers.providers.Web3Provider(_ganacheProv as any);

    // this._signer = this._provider.getSigner(0);
    if (window.ethereum === undefined || !window.ethereum.isMetaMask) {
      throw new Error("Need metamask");
    }

    // A Web3Provider wraps a standard Web3 provider, which is
    // what MetaMask injects as window.ethereum into each page
    // FIXME:
    // const ethereum = MMSDK.getProvider(); // You can also access via window.ethereum
    this._provider = new ethers.providers.Web3Provider(window.ethereum as any);

    // MetaMask requires requesting permission to connect users accounts
    await this._provider.send("eth_requestAccounts", []);

    await this._detectMountpoint();
    window.ethereum.on('chainChanged', async () => {
      window.location.reload();
    })


    // The MetaMask plugin also allows signing transactions to
    // send ether and pay to change state within the blockchain.
    // For this, you need the account signer...
    this._signer = this._provider.getSigner()

    const signerBalance = await this._signer!.getBalance();
    console.log('signer address: ', await this._signer?.getAddress())
    console.log('signerBalance: ', signerBalance.toBigInt().toString());

    this._deployer = new FirmContractDeployer(this._provider);
    await this._deployer.init(noDeploy);

    this._abiLib = await this._deployer.deployAbi(noDeploy);

    this._implLib = await this._deployer.deployFirmChainImpl(this._abiLib, noDeploy);

    this._accSystemLib = await this._deployer.deployAccountSystemImpl(noDeploy);

    const fsContract = await this._deployer.deployFilesystem(noDeploy);
    console.log('fsContract: ', fsContract.address);

    if (car !== undefined) {
      await this.initFromCar(car);
    }
  }

  async shutDown(): Promise<void> {
  }

  isReady(): boolean {
    return isDefined([
      this._provider, this._signer, this._deployer,
      this._abiLib, this._implLib, this._accSystemLib,
      this._mountpoint
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
      mountpoint: this._mountpoint!,
    }
  }

  private async _createGenesisBlock(args: Required<EFConstructorArgs, 'threshold'>): Promise<OptExtendedBlockValue> {
    const confOps = args.confirmers.map(conf => {
      return createAddConfirmerOp(conf.address, 1);
    });
    return createGenesisBlockVal([], confOps, args.threshold);
  }

  private async _deployEFChain(
    fchainImpl: FirmChainImpl,
    accSystemImpl: AccountSystemImpl,
    args: Required<EFConstructorArgs, 'threshold'>,
    genesisBl?: OptExtendedBlockValue
  ) {
    const { deployer, provider } = this._getInitialized();

    const factory = new XEdenPlusFractal__factory({
      ["contracts/FirmChainImpl.sol:FirmChainImpl"]: fchainImpl.address,
      ["contracts/AccountSystemImpl.sol:AccountSystemImpl"]: accSystemImpl.address,
    }, this._signer);

    const confs: AccountValue[] = [];
    for (const conf of args.confirmers) {
      assert(Object.keys(conf.extAccounts).length === 0, "External account map not supported for now");
      confs.push({
        addr: conf.address,
        name: conf.name,
        metadataId: ZeroId,
      });
    }

    if (genesisBl === undefined) {
      genesisBl = await this._createGenesisBlock(args);
    }

    const dtx = await factory.getDeployTransaction(
      genesisBl,
      confs,
      args.threshold,
      args.name, args.symbol,
      utils.hexZeroPad('0x00', 32),
      provider.network.chainId,
    );
    const bytecode = dtx.data;
    assert(bytecode !== undefined, 'bytecode should be defined');
    const addr = await deployer.detDeployContract(bytecode ?? '', `${args.name} (EFChain)`);

    genesisBl.contract = addr;

    return { contract: factory.attach(addr), genesisBl };
  }

  // TODO:
  // * Take name of a contract function
  async _accessState<RetType>(chain: Chain, blockId: BlockId, f: () => Promise<RetType>): Promise<RetType> {
    const headId = await chain.contract.getHead();
    if (headId !== blockId) {
      throw new OpNotSupprtedError("Historical or future state access unsupported for now")
    } else {
      return await f();
    }
  }

  async _getAccountById(chain: Chain, accountId: AccountId): Promise<Account | undefined> {
    const val = await chain.contract.getAccount(accountId);
    if (val.addr === this.NullAccountAddr) {
      return undefined;
    }

    return {
      id: accountId,
      name: val.name,
      address: val.addr ? val.addr : undefined,
      extAccounts: {},
    }
  }

  _confirmerSetFromBlock(block: OptExtendedBlockValue): ConfirmerSet {
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

  async _signBlock(wallet: Wallet, block: OptExtendedBlockValue): Promise<Signature> {
    const digest = getBlockDigest(block.header);
    return await wallet.ethSign(digest);
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

  isWallet(walletOrSig: Wallet | Confirmation): walletOrSig is Wallet {
    return (
      'sign' in walletOrSig && typeof walletOrSig.sign === 'function'
    );
  }

  private async confirm(blockId: BlockId, walletOrSig: Wallet | Confirmation): Promise<void> {
    const { provider } = this._getInitialized();

    const block = this._st.blocks[blockId];        
    if (!block) {
      throw new NotFound("Block not found");
    }
    const prevBlock = this._st.blocks[utils.hexlify(block.header.prevBlockId)];
    const chain = this._st.chains[block.contract ?? 0];
    if (!chain) {
      throw new NotFound("Chain not found");
    }
    const blockNum = this._st.blockNums[blockId];
    if (blockNum === undefined) {
      throw new ProgrammingError("Block number not stored");
    }

    const ordBlocks = this._st.orderedBlocks[chain.contract.address];
    if (!ordBlocks || !ordBlocks[blockNum]) {
      throw new ProgrammingError("Block not saved into orderedBlocks index");
    }

    const [signature, address] = this.isWallet(walletOrSig)
      ? [await this._signBlock(walletOrSig, block), walletOrSig.getAddress()]
      : [walletOrSig.sig, walletOrSig.address]

    // await provider.send('evm_mine', []);

    const rValue = await chain.contract.callStatic.extConfirm(
      block.header,
      address,
      signature,
    );
    if (!rValue) {
      throw new Error("Contract returned false");
    }

    // await provider.send('evm_mine', []);

    const tx = await chain.contract.extConfirm(
      block.header,
      address,
      signature,
    );
    // Will throw if tx fails
    await tx.wait()

    let bConfs = this._st.confirmations[blockId];

    if (!bConfs) {
      throw new ProgrammingError("Confirmations empty");
    }

    this._st.confirmations[blockId] = [
      ...bConfs,
      {
        address: address,
        sig: await toValue(signature)
      }
    ];
    bConfs = this._st.confirmations[blockId]!;
    const confirmAddrs = bConfs.map(v => v.address);
    const confirmStatus = prevBlock ? 
      this._confirmStatusFromBlock(prevBlock, confirmAddrs)
      : this._confirmStatusForGenesis();
    if (confirmStatus.final) {
      // console.log("headBlock: ", await chain.contract.getHead());
      // console.log("getBlockId(block): ", getBlockId(block.header));
      // await provider.send('evm_mine', []);
      const tx = await chain.contract.finalizeAndExecute(block);
      await tx.wait();
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
      this._st.states[blockId] = await getEFChainState(bl!);
    } else {
      // Update confirmation state
      this._st.states[blockId] = {
        delegates: emptyDelegates,
        directoryId: ZeroId,
        confirmations: confirmAddrs,
        confirmationStatus: confirmStatus,
        confirmerSet: this._confirmerSetFromBlock(block),
        allAccounts: false,
      }
    }
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
        return this.confirm(blockId, w);
      }
    };
  }

  async createEFChain(args: EFConstructorArgs, genesisBlock?: OptExtendedBlockValue): Promise<EFChain> {
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

    // await provider.send('evm_mine', []);
    const { contract, genesisBl } = await this._deployEFChain(implLib, accSystemLib, nargs, genesisBlock);

    const bId = getBlockId(genesisBl.header);
    this._st.blocks[bId] = genesisBl;
    this._st.blockNums[bId] = 0;
    const ordBlocks: BlockId[][] = [[bId]];
    this._st.orderedBlocks[contract.address] = ordBlocks;
    this._st.msgs[bId] = [];
    this._st.confirmations[bId] = [];
    this._st.chains[contract.address] = {
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
      this._st.states[bId] = await getEFChainState(genesisBl!);
      return chain;
    }
  }

  private async _createBlock(
    blockById: EFChain['blockById'],
    prevBlockId: BlockId,
    messages: EFMsg[],
    bl?: OptExtendedBlockValue
  ): Promise<EFBlock> {
    // TODO: Check if we have prevBlock
    const prevBlock = this._st.blocks[prevBlockId];
    const prevBlockNum = this._st.blockNums[prevBlockId];
    if (!prevBlock || (prevBlockNum === undefined)) {
      throw new NotFound("Previous block not found");
    }
    const chain = this._st.chains[prevBlock.contract ?? 0];
    if (!chain) {
      throw new NotFound("Chain not found");
    }

    const ordBlocks = this._st.orderedBlocks[chain.contract.address];
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
        confOps = msg.ops.map((op) => this._convertConfirmerOp(op));
      } else if (bl === undefined) {
        if (msg.name === 'createAccount') {
          assert(Object.keys(msg.account.extAccounts).length === 0, "External account map not supported for now");
          const acc: AccountValue = {
            addr: msg.account.address ?? ZeroAddr,
            name: msg.account.name,
            metadataId: ZeroId,
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
          assert(Object.keys(msg.newAccount.extAccounts).length === 0, "External account map not supported for now");
          const newAcc = {
            addr: msg.newAccount.address ?? ZeroAddr,
            name: msg.newAccount.name,
            metadataId: ZeroId
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
    }

    const block = bl === undefined 
      ? await createUnsignedBlockVal(
          prevBlock, chain.contract, serializedMsgs,
          confOps, newThreshold
        )
      : bl;

    const bId = getBlockId(block.header);
    const blockNum = prevBlockNum + 1;
    this._st.blocks[bId] = block;
    this._st.blockNums[bId] = blockNum;
    this._st.msgs[bId] = messages;
    this._st.confirmations[bId] = [];
    const confSet = this._confirmerSetFromBlock(block);
    const confirmStatus = this._confirmStatusFromBlock(prevBlock, []);
    this._st.states[bId] = {
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


  async getChain(address: Address): Promise<EFChain | undefined> {
    this._getInitialized();
    const chain = this._st.chains[address];
    if (!chain) {
      return undefined;
    }

    const blockById: (id: BlockId) => Promise<EFBlock | undefined> = async (id: BlockId) => {
      const block = this._st.blocks[id];
      const height = this._st.blockNums[id];
      const messages = this._st.msgs[id];
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
          confirmerSet: this._confirmerSetFromBlock(block),
          confirmations: () => {
            return new Promise((resolve) => {
              const confs = this._st.confirmations[id];
              if (confs) {
                resolve(confs.map(v => v.address));
              } else {
                resolve([]);
              }
            });
          },
          confirmationStatus: () => {
            return new Promise((resolve, reject) => {
              const confs = this._st.confirmations[id];
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
                  const prevBlock = this._st.blocks[utils.hexlify(block.header.prevBlockId)];
                  if (!prevBlock) {
                    reject(new ProgrammingError("Previous block not recorded"));
                  } else {
                    resolve(this._confirmStatusFromBlock(prevBlock, confs.map(v => v.address)));
                  }
                }
              }
            });
          },
          delegate: (weekIndex: number, roomNumber: number) => {
            return this._accessState(chain, id, async () => {
              const bn = await chain.contract.getDelegate(weekIndex, roomNumber);
              const val = bn.toNumber();
              if (val === this.NullAccountId) {
                return undefined;
              } else {
                return val;
              }
            });
          },

          delegates: (weekIndex: number) => {
            return this._accessState(chain, id, async () => {
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
            return this._accessState(chain, id, async () => {
              const bn = await chain.contract.balanceOfAccount(id);
              return bn.toNumber();
            });
          },

          balanceByAddr: (address: Address) => {
            return this._accessState(chain, id, async () => {
              const bn = await chain.contract.balanceOf(address);
              return bn.toNumber();
            });
          }, 

          totalSupply: () => {
            return this._accessState(chain, id, async () => {
              const bn = await chain.contract.totalSupply();
              return bn.toNumber();
            });
          },

          accountById: (accountId: AccountId) => {
            return this._accessState(chain, id, async () => {
              return await this._getAccountById(chain, accountId);
            });
          },

          accountByAddress: (address: Address) => {
            return this._accessState(chain, id, async () => {
              const accountId = (await chain.contract.byAddress(address)).toNumber();
              if (accountId === this.NullAccountId) {
                return undefined;
              }
              return await this._getAccountById(chain, accountId);
            });
          }, 

          directoryId: () => {
            return this._accessState(chain, id, async () => {
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
      const state = this._st.states[blockId];
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
          const bl = this._st.blocks[prevBlock];          
          if (!bl) {
            throw new InvalidArgument("No block with this id");
          }

          const confSet = this.convertFcConfirmerSet(bl.state.confirmerSet);
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
        return this._createBlock(blockById, prevBlockId, messages);
      }
    }

    const getSlots = async (start?: number, end?: number) => {
      const ordBlocks = this._st.orderedBlocks[chain.contract.address];
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
      const ordBlocks = this._st.orderedBlocks[chain.contract.address];
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
          const state = this._st.states[blockId];
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

  lsChains(): Address[] {
    return Object.keys(this._st.chains);
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