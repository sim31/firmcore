import { Optional, Overwrite, Required } from 'utility-types';
import { AccountSystemImpl, AccountSystemImpl__factory, AccountValue, BlockIdStr, ConfirmerOpValue, EdenPlusFractal, EdenPlusFractal__factory, FirmChain, FirmChainAbi, FirmChainAbi__factory, FirmChainImpl, FirmChainImpl__factory, GenesisBlock, IPFSLink, Message, OptExtendedBlock, OptExtendedBlockValue, ZeroId, BreakoutResults, Signature, AddressStr, SignatureValue, toValue, XEdenPlusFractal, XEdenPlusFractal__factory, GenesisBlockValue, BlockValue, InitConfirmerSet, MessageValue, BlockHeader, BlockHeaderValue } from "firmcontracts/interface/types.js";
import { IFirmCore, EFChain, EFConstructorArgs, Address, Account, BlockId, EFBlock, EFMsg, AccountId, ConfirmerSet, ConfirmerMap, EFBlockBuilder, BlockConfirmer, ConfirmerOpId, ConfirmerOp, ConfirmationStatus, toEFChainPODSlice, UpdateConfirmersMsg, AccountWithAddress, Confirmer, EFBlockPOD, EFChainState, getEFChainState, EFChainPODSlice, toEFBlockPOD, emptyDelegates, toValidSlots, ValidEFChainPOD, ValidSlots, NormEFChainPOD, normalizeSlots, NormalizedSlots, Await, IMountedFirmCore, ChainNetworkInfo, MountPointChangedCb, MountedEFChain, SyncState, newAccountWithAddress, newUknownMsg, newAccount, newCreateAccountMsg, newRemoveAccountMsg, newSetDirMsg, newUpdateAccountMsg, newEFSubmitResultsMsg, newEFBreakoutResults, EFBreakoutResults, newUpdateConfirmersMsg } from "../ifirmcore/index.js";
import { BigNumber, BigNumberish, BytesLike, ethers, utils } from "ethers";
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
import assert, { assertDefined } from '../helpers/assert.js';
import { defaultThreshold, updatedConfirmerMap } from '../helpers/confirmerSet.js';
import { bytes32StrToCid0, cid0ToBytes32Str } from 'firmcontracts/interface/cid.js';
import { isDefined } from '../helpers/defined.js';
import { CarFileInfo, FileOptions, MTime, anyToCAR, createCARFile, objectToCAR, objectToFile, readCARFile, unixfsFileToObj } from '../helpers/car.js';
import stringify from 'json-stable-stringify-without-jsonify';
import { FileCandidate } from 'ipfs-unixfs-importer';
import { MetaMaskSDK } from '@metamask/sdk';
import { ByzantineChain } from '../exceptions/ByzantineChain.js';

interface Chain {
  contract: XEdenPlusFractal | Address,
  constructorArgs: EFConstructorArgs;
  genesisBlId: BlockIdStr;
  headBlockId: BlockIdStr;
}
type SerializableChain = Overwrite<Chain, {
  contract: Address
}>;

function isContract(c: XEdenPlusFractal | Address): c is XEdenPlusFractal {
  return typeof c === 'object'
}
function getAddress(c: XEdenPlusFractal | Address): Address {
  return isContract(c) ? c.address : c;
}

type UnknownBlock =
  Pick<OptExtendedBlockValue, 'signatures' | 'signers' | 'contract' | 'header'>
  & {
    header: Optional<BlockHeaderValue, 'blockBodyId' | 'timestamp'>
  }

type ParsedBlock = OptExtendedBlockValue & { messages: EFMsg[] };

function isKnownBlock(bl: UnknownBlock | OptExtendedBlockValue | undefined): bl is OptExtendedBlockValue {
  return bl !== undefined && 'header' in bl && 'confirmerSetId' in bl && 'msgs' in bl;
}

export function assertKnownBlock(bl: UnknownBlock | OptExtendedBlockValue | undefined): OptExtendedBlockValue {
  assert(isKnownBlock(bl), 'Expected OptExtendedBlockValue');
  return bl as OptExtendedBlockValue;
}


type Confirmation = {
  address: Address
  sig: SignatureValue
}

// TODO: remove for serialization:
// * Chain.contract
interface FirmCoreState {
  chains: Record<Address, Chain>;
  blocks: Record<BlockId, OptExtendedBlockValue | UnknownBlock>;
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
  
  private _factory: XEdenPlusFractal__factory | undefined;

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
          contract: isContract(v.contract) ? v.contract.address : v.contract
        }
      })
    };
  }

  private serializeFcState(options?: FileOptions): FileCandidate {
    const serializable = this._toSerializableFcState();
    return objectToFile(serializable, options);
  }

  private _storeState() {
    const s = this._toSerializableFcState();
    localStorage.setItem('firmcore', JSON.stringify(s));
  }
  
  private _retrieveState(): SerializableFcState | null {
    const str = localStorage.getItem('firmcore');
    if (str === null) {
      return null;
    } else {
      return JSON.parse(str) as SerializableFcState;
    }
  }

  private async _initFromStorage() {
    const { deployer, factory } = this._getInitialized();

    const sstate = this._retrieveState();
    if (sstate === null) {
      return;
    }

    const state: FirmCoreState = {
      ...sstate,
      chains: {}
    }

    for (const schain of sstate.chains) {
      const addr = schain.contract;
      const contract = await deployer.contractExists(addr) ?
        factory.attach(addr) : addr;
      state.chains[addr] = {
        ...schain,
        contract
      }
    }
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
      const genesisBl = assertKnownBlock(fcState.blocks[chain.genesisBlId]);
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
            const block = assertKnownBlock(fcState.blocks[blockId]);
            const prevBlockId = block.header.prevBlockId;
            const msgs = fcState.msgs[blockId];
            if (msgs === undefined) {
              throw new InvalidArgument('Invalid car: messages for a block missing');
            }
            const bl = assertDefined(await this._createBlock(
              utils.hexlify(prevBlockId),
              msgs,
              efChain.blockById,
              block
            ));
            if (bl.id !== getBlockId(block.header)) {
              throw new InvalidArgument('Invalid car: blocks id');
            }

            const confirmations = fcState.confirmations[bl.id];
            if (confirmations === undefined) {
              throw new InvalidArgument('Invalid car: confirmations should be defined');
            }
            for (const confirmation of confirmations) {
              await this._confirm(bl.id, confirmation);              
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

    this._factory = new XEdenPlusFractal__factory({
      ["contracts/FirmChainImpl.sol:FirmChainImpl"]: this._implLib.address,
      ["contracts/AccountSystemImpl.sol:AccountSystemImpl"]: this._accSystemLib.address,
    }, this._signer);


    await this._initFromStorage();

    // if (car !== undefined) {
    //   await this.initFromCar(car);
    // }
  }

  async shutDown(): Promise<void> {
  }

  isReady(): boolean {
    return isDefined([
      this._provider, this._signer, this._deployer,
      this._abiLib, this._implLib, this._accSystemLib,
      this._mountpoint, this._factory,
    ]);
  }

  private _getInitialized() {
    assert(this.isReady(), 'firmcore must be initialized first');
    return {
      provider: this._provider!,
      signer: this._signer!,
      deployer: this._deployer!,
      abiLib: this._abiLib!,
      implLib: this._implLib!,
      accSystemLib: this._accSystemLib!,
      mountpoint: this._mountpoint!,
      factory: this._factory!,
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
    const { deployer, provider, factory } = this._getInitialized();

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
  private async _accessState<RetType>(
    chain: Chain,
    blockId: BlockId,
    f: (contract: XEdenPlusFractal) => Promise<RetType>
  ): Promise<RetType> {
    if (!isContract(chain.contract)) {
      throw new ProgrammingError('Contract not deployed');
    }
    const headId = await chain.contract.getHead();
    if (headId !== blockId) {
      throw new OpNotSupprtedError("Historical or future state access unsupported for now")
    } else {
      return await f(chain.contract);
    }
  }

  private async _getAccountById(chain: Chain, accountId: AccountId): Promise<Account | undefined> {
    if (!isContract(chain.contract)) {
      throw new ProgrammingError("Contract not deployed");
    }
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

  private _confirmerSetFromBlock(block: OptExtendedBlockValue): ConfirmerSet {
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

  private _confirmStatusFromBlock(prevBlock: OptExtendedBlockValue, confirms: Address[]): ConfirmationStatus {
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

  private _confirmStatusForGenesis(): ConfirmationStatus {
    return {
      threshold: 0,
      currentWeight: 0,
      potentialWeight: 0,
      final: false,
    };
  }

  private async _signBlock(wallet: Wallet, block: OptExtendedBlockValue): Promise<Signature> {
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

  private _convertConfOpId(id: ConfirmerOpId): number {
    return id === 'add' ? 0 : 1;
  }

  private _convertConfirmerOp(op: ConfirmerOp): ConfirmerOpValue {
    return {
      opId: this._convertConfOpId(op.opId),
      conf: {
        addr: op.confirmer.address,
        weight: op.confirmer.weight,
      }
    };
  }

  private _convertConfOpValId(id: BigNumberish): ConfirmerOpId {
    return id === 0 ? 'add' : 'remove';
  }

  private _convertConfirmerOpValue(op: ConfirmerOpValue): ConfirmerOp {
    return {
      opId: this._convertConfOpValId(op.opId),
      confirmer: {
        address: op.conf.addr,
        weight: op.conf.weight
      }
    }
  }

  isWallet(walletOrSig: Wallet | Confirmation): walletOrSig is Wallet {
    return (
      'sign' in walletOrSig && typeof walletOrSig.sign === 'function'
    );
  }

  private async _confirm(
    blockId: BlockId,
    walletOrSig: Wallet | Confirmation,
    virtual?: boolean
  ): Promise<void> {
    const { provider } = this._getInitialized();

    const block = assertKnownBlock(this._st.blocks[blockId]);
    const prevBlock = assertKnownBlock(this._st.blocks[utils.hexlify(block.header.prevBlockId)]);
    const chain = this._st.chains[block.contract ?? 0];
    if (!chain) {
      throw new NotFound("Chain not found");
    }
    const blockNum = this._st.blockNums[blockId];
    if (blockNum === undefined) {
      throw new ProgrammingError("Block number not stored");
    }

    if (!isContract(chain.contract)) {
      throw new ProgrammingError('Chain not deployed');
    }

    const ordBlocks = this._st.orderedBlocks[chain.contract.address];
    if (!ordBlocks || !ordBlocks[blockNum]) {
      throw new ProgrammingError("Block not saved into orderedBlocks index");
    }

    const [signature, address] = this.isWallet(walletOrSig)
      ? [await this._signBlock(walletOrSig, block), walletOrSig.getAddress()]
      : [walletOrSig.sig, walletOrSig.address]

    if (!virtual) {
      const rValue = await chain.contract.callStatic.extConfirm(
        block.header,
        address,
        signature,
      );
      if (!rValue) {
        throw new Error("Contract returned false");
      }

      const tx = await chain.contract.extConfirm(
        block.header,
        address,
        signature,
      );
      // Will throw if tx fails
      await tx.wait()
    }

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
    if (confirmStatus.final && !virtual) {
      // console.log("headBlock: ", await chain.contract.getHead());
      // console.log("getBlockId(block): ", getBlockId(block.header));
      // await provider.send('evm_mine', []);
      chain.headBlockId = blockId;
      const tx = await chain.contract.finalizeAndExecute(block);
      await tx.wait();
      const head = await chain.contract.getHead();
      assert(head === blockId, "head of the chain should have been updated");
      // console.log("headBlock2: ", await chain.contract.getHead());
      // console.log("head: ", head);
      // console.log("blockId: ", blockId);
      const ch = await this.getChain(chain.contract.address);
      assert(ch, "should be able to retrieve chain");
      const bl = await ch!.blockById(blockId);
      assert(bl, "should be able to retrieve EFBlock");
      this._st.states[blockId] = await getEFChainState(bl!);
    } else {
      if (confirmStatus.final) {
        chain.headBlockId = blockId;
      }
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
        return this._confirm(blockId, w);
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

    const { provider, implLib, accSystemLib, factory } = this._getInitialized();

    // await provider.send('evm_mine', []);
    const { contract, genesisBl } = await this._deployEFChain(implLib, accSystemLib, nargs, genesisBlock);

    const bId = this._storeNewFirmChain(genesisBl, contract, args);

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
    prevBlockId: BlockId,
    messages: EFMsg[],
    blockById?: EFChain['blockById'],
    bl?: OptExtendedBlockValue
  ): Promise<EFBlock | undefined> {
    // TODO: Check if we have prevBlock
    const prevBlock = assertKnownBlock(this._st.blocks[prevBlockId]);
    const prevBlockNum = this._st.blockNums[prevBlockId];
    if (!prevBlock || (prevBlockNum === undefined)) {
      throw new NotFound("Previous block not found");
    }
    const chain = this._st.chains[prevBlock.contract ?? 0];
    if (!chain) {
      throw new NotFound("Chain not found");
    }

    if (!isContract(chain.contract)) {
      throw new ProgrammingError('Firmchain not deployed');
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
    if (blockById !== undefined) {
      const efBlock = await blockById(bId);
      if (!efBlock) {
        throw new ProgrammingError("Unable to retrieve created block");
      }
      return efBlock;
    } else {
      undefined;
    }
  }

  private _decodeMsg(contract: XEdenPlusFractal, msg: MessageValue): EFMsg {
    if (msg.addr !== contract.address) {
      return newUknownMsg(msg.addr);
    }

    const t = { data: ethers.utils.hexlify(msg.cdata) };
    const { args, name } = contract.interface.parseTransaction(t);
    switch (name) {
      case 'updateConfirmerSet': {
        const opValues = args['ops'] as ConfirmerOpValue[];
        const ops = opValues.map(op => this._convertConfirmerOpValue(op));
        const threshold = args['threshold']; 
        return newUpdateConfirmersMsg(ops, threshold)
      }
      case 'createAccount': {
        const addr = args['account']['addr'] === ZeroAddr ? undefined: args['addr'];
        const name = args['account']['name'];
        assert(typeof name === 'string', 'name argument expected');
        const account = newAccount({}, name, addr);
        return newCreateAccountMsg(account);
      }
      case 'removeAccount': {
        const id = args['id']
        // TODO: can you check for id being a number
        assert(id !== undefined, 'id argument expected');
        return newRemoveAccountMsg(id);
      }
      case 'setDir': {
        const dirId = args['dirId'];
        assert(typeof dirId === 'string', 'dirId argument expected');
        const cid0 = bytes32StrToCid0(dirId);
        return newSetDirMsg(cid0);
      }
      case 'updateAccount': {
        const id = args['id'];
        // TODO: can you check for id being a number
        assert(id !== undefined, 'id argument expected');
        const addr = args['account']['addr'] === ZeroAddr ? undefined: args['addr'];
        const name = args['account']['name'];
        assert(typeof name === 'string', 'name argument expected');
        const account = newAccount({}, name, addr);
        return newUpdateAccountMsg(id, account);
      }
      case 'submitResults': {
        const resultsArr = args['newResults'];
        const rResults: EFBreakoutResults[] = []
        for (const res of resultsArr) {
          const delegate = res['delegate'];
          const ranks = res['ranks'];
          assert(delegate !== undefined, 'delegate expected');
          assert(typeof ranks === 'object', 'ranks expected');
          rResults.push(newEFBreakoutResults(delegate, ...ranks));
        }
        return newEFSubmitResultsMsg(rResults);
      }
      default: {
        throw new OpNotSupprtedError('Unrecognized message');
      }
    }
  }

  // Functions to retrive stuff from mounted chain
  private async _getProposedBlocksM(
    contract: XEdenPlusFractal,
    prevBlockId: BlockId,
  ): Promise<BlockValue[]> {
    const nProposalFilter = contract.filters.BlockProposed(prevBlockId);
    const propEvents = await contract.queryFilter(nProposalFilter);
    const bls: BlockValue[] = [];
    for (const ev of propEvents) {
      const tx = await ev.getTransaction();            
      const ptx = contract.interface.parseTransaction(tx);
      const b = assertDefined(ptx.args['bl']) as BlockValue;
      bls.push(b);
    }
    return bls;
  }

  private async _getProposedBlockM(
    contract: XEdenPlusFractal,
    prevBlockId: BlockId,
    expectedBlId: BlockId
  ): Promise<BlockValue | undefined> {
    const bls = await this._getProposedBlocksM(contract, prevBlockId);
    for (const bl of bls) {
      const id = getBlockId(bl.header);
      if (id === expectedBlId) {
        return bl;
      }
    }
    return undefined;
  }

  private async _getExecutedBlock(
    contract: XEdenPlusFractal,
    blockId: BlockId
  ): Promise<BlockValue | undefined> {
    const nExecFilter = contract.filters.BlockExecuted(blockId);
    const execEvent = (await contract.queryFilter(nExecFilter))[0];
    if (execEvent !== undefined) {
      const tx = await execEvent.getTransaction();
      const ptx = contract.interface.parseTransaction(tx);
      return assertDefined(ptx.args['bl']);
    }
    return undefined;
  }

  private async _getConfirmationsOnBlock(
    contract: XEdenPlusFractal,
    blockId: BlockId
  ): Promise<Confirmation[]> {
    const confirmFilter = contract.filters.BlockConfirmation(null, blockId);
    const events = await contract.queryFilter(confirmFilter);
    const confirms: Confirmation[] = [];
    for (const ev of events) {
      const tx = await ev.getTransaction();
      const ptx = contract.interface.parseTransaction(tx);
      const signatory = assertDefined(ptx.args['signatory']);
      const sig = assertDefined(ptx.args['sig']);
      confirms.push({ address: signatory, sig });
    }
    return confirms;
  }

  private async _getNexFinalizedBlockHead(
    contract: XEdenPlusFractal,
    prevBlockId: BlockId
  ): Promise<BlockHeaderValue | undefined> {
    const nPrevBlockNum = assertDefined(this._st.blockNums[prevBlockId]);
    const nFinalBlockFilter = contract.filters.BlockFinalized(prevBlockId);
    const events = await contract.queryFilter(nFinalBlockFilter);
    if (events.length > 1) {
      throw new ByzantineChain('Two finalized events extending the same block');
    } else if (events.length === 0) {
      return undefined;
    }

    const event = events[0]!;
    const tx = await event.getTransaction();
    const ptx = contract.interface.parseTransaction(tx);
    const header = assertDefined(ptx.args['header']) as BlockHeaderValue;

    return header;
  }

  /**
   * Throws on error
   */
  private _storeNewFirmChain(
    genesisBl: OptExtendedBlockValue,
    contract: XEdenPlusFractal,
    cargs: EFConstructorArgs,
    messages?: EFMsg[]
  ): BlockId {
    const bId = getBlockId(genesisBl.header);
    this._st.blocks[bId] = genesisBl;
    this._st.blockNums[bId] = 0;
    const ordBlocks: BlockId[][] = [[bId]];
    this._st.orderedBlocks[contract.address] = ordBlocks;
    this._st.msgs[bId] = messages !== undefined ? messages : [];
    this._st.confirmations[bId] = [];
    this._st.chains[contract.address] = {
      contract,
      constructorArgs: cargs,
      headBlockId: bId,
      genesisBlId: bId,
    };
    return bId;
  }

  /**
   * Initialized firmchain in the local state based on logs found on the mounted chain (produced by constructor of firmchain smart contract).
   */
  private async _initFChainFromMounted(contract: XEdenPlusFractal): Promise<void> {
    const { factory } = this._getInitialized();

    const events = await contract.queryFilter(contract.filters.Construction());
    if (events.length !== 1) {
      throw new NotFound('Construction event not found in the mounted chain');
    }
    // Get constructor args
    // TODO: move to deployer
    const event = events[0]!;
    const dtx = await event.getTransaction();

    const dtxLength = ethers.utils.hexDataLength(dtx.data);
    const argsLength = dtxLength - ethers.utils.hexDataLength(factory.bytecode);
    console.log('argsLength: ', argsLength, ', dtx.data.length: ', dtxLength);

    const argData = ethers.utils.hexDataSlice(dtx.data, dtxLength - argsLength);

    console.log('argData: ', argData);

    // ethers.utils.defaultAbiCoder.decode()
    // factory.interface.deploy.
    const args = ethers.utils.defaultAbiCoder.decode(factory.interface.deploy.inputs, argData);
    console.log("decoded args: ", args);

    const genesisBl = args['genesisBl'] as BlockValue;
    const gbId = getBlockId(genesisBl.header);
    const confirmers = args['confirmers'] as AccountValue[];
    const confOps = confirmers.map(conf => {
      return createAddConfirmerOp(conf.addr, 1);
    });
    const threshold = args['threshold'] as number;
    const confSet = updatedConfirmerSet(InitConfirmerSet, confOps, threshold);
    const genesisBlExt: GenesisBlockValue = {
      ...genesisBl,
      state: {
        blockId: gbId,
        blockNum: 0,
        confirmerSet: confSet
      }
    }
    const name = args['name'] as string;
    const symbol = args['symbol'] as string;
    const messages = genesisBl.msgs.map(msg => this._decodeMsg(contract, msg));
    const accConfirmers = confirmers.map(c => newAccountWithAddress({}, c.addr, c.name));
    const cargs: EFConstructorArgs = {
      confirmers: accConfirmers,
      name, symbol
    };

    this._storeNewFirmChain(genesisBlExt, contract, cargs, messages);
  }

  private _parseBlockValue(
    block: BlockValue,
    prevBlock: OptExtendedBlockValue,
    contract: XEdenPlusFractal
  ): ParsedBlock {
    const messages = block.msgs.map(msg => this._decodeMsg(contract, msg));
    const confOpMsg = (messages.filter(m => m.name === 'updateConfirmers'))[0] as UpdateConfirmersMsg;
    const confirmerOps = confOpMsg.ops.map(op => this._convertConfirmerOp(op));
    const newThreshold = confOpMsg.threshold;
    const confSet = updatedConfirmerSet(prevBlock.state.confirmerSet, confirmerOps, newThreshold);
    const bId = getBlockId(block.header);
    const b: ParsedBlock = {
    ...block,
      state: {
        blockId: bId,
        blockNum: prevBlock.state.blockNum,
        confirmerSet: confSet
      },
      messages,
    }
    return b;
  }

  private async _syncChainProposals(contract: XEdenPlusFractal): Promise<void> {
    const ch = assertDefined(this._st.chains[contract.address]);
    const headBlId = ch.headBlockId;
    // Head block should be known block because it is executed if it is head (and if it is executed, execute event was called, which enables us to learn the full block from transaction)
    const headBl = assertKnownBlock(this._st.blocks[headBlId]);
    const blockValues = await this._getProposedBlocksM(contract, headBlId);
    for (const val of blockValues) {
      const block = this._parseBlockValue(
        val, headBl, contract
      );
      await this._createBlock(headBlId, block.messages, undefined, block);
      await this._collectConfirmationsFromMounted(contract, block.state.blockId);
    }
  }

  private async _syncChainFc(address: Address): Promise<SyncState> {
    const { factory, deployer } = this._getInitialized();

    const existingChain = this._st.chains[address];
    let contract: XEdenPlusFractal;

    // Initialize contract instance which we will use to interact with firmchain on the mounted chain
    if (existingChain === undefined) {
      if (await deployer.contractExists(address)) {
        contract = factory.attach(address);        
      } else {
        throw new NotFound('Chain not found');
      }
    } else if (!isContract(existingChain.contract)) {
      if (await deployer.contractExists(address)) {
        contract = factory.attach(address);        
        existingChain.contract = contract;
      } else {
        // Case when firmchain is not deployed to the mounted chain
        return { status: 'behind', insyncBlocks: 0 }
      }
    } else {
      contract = existingChain.contract;
    }

    // Sync up to head, then sync proposed blocks.
    const syncState: SyncState = await this._syncChainHeadFc(contract);
    await this._syncChainProposals(contract);

    // After syncing proposed blocks we might change the status
    // of some of them to finalized. This would make the mounted chain
    // be behind as far as sync state. So we need to adjust syncState after
    // syncing proposed blocks;
    // Note that the only thing missing in the mounted chain for it to be insync
    // might be a call to `finalizeAndExecute` or just `execute`.
    const chain = assertDefined(this._st.chains[address]);
    const headBlNum = assertDefined(this._st.blockNums[chain.headBlockId]);
    if (syncState.insyncBlocks < headBlNum) {
      return { ...syncState, status: 'behind' }
    } else {
      return syncState;
    }
  }

  private async _collectConfirmationsFromMounted(
    contract: XEdenPlusFractal, onBlockId: BlockId
  ): Promise<void> {
    // Collect confirmations for this block
    const confirmations = await this._getConfirmationsOnBlock(contract, onBlockId);
    for (const confirm of confirmations) {
      await this._confirm(onBlockId, confirm, true);
    }
  }

  /**
   * Syncs up to chain head (not including proposed but not executed blocks).
   * If local state of firmchain is ahead, it returns the appropriate SyncState
   * It also initialized record of specified firmchain in the firmcore state,
   * in case it is not present there yet.
   */
  private async _syncChainHeadFc(contract: XEdenPlusFractal): Promise<SyncState> {
    const existingChain = this._st.chains[contract.address];
    const headBlId = await contract.getHead();
    const blockNum = this._st.blockNums[headBlId];
    if (existingChain !== undefined && headBlId === existingChain.headBlockId) {
      // Case when firmchain exists in firmcore state and head block matches in the mounted chain (this means that firmchains are insync).
      // We might still be missing some proposed blocks, but it is not up to this function to solve this
      if (blockNum === undefined) {
        throw new ProgrammingError('block num not stored');
      }
      return {
        status: 'insync',
        insyncBlocks: blockNum,
      }
    } else if (existingChain !== undefined) {
      // Case when firmchain exists in firmcore state, but it's head (latest block) does not match head in the mounted chain;
      const exHeadId = existingChain.headBlockId;
      const exBlockNum = this._st.blockNums[exHeadId];
      if (exBlockNum === undefined) {
        throw new ProgrammingError("Block number not stored for head block");
      }
      if (blockNum !== undefined && blockNum < exBlockNum) {
        // Case when the mounted chain misses some of the blocks we have locally
        const st = this._st.states[headBlId];
        if (!st?.confirmationStatus?.final) {
          throw new ProgrammingError('Fork: block finalized in the mounted chain, not final locally');
        }
        return {
          status: 'behind',
          insyncBlocks: blockNum
        };
      } else if (blockNum !== undefined && blockNum === exBlockNum) {
        throw new ProgrammingError('Fork: head block does not match, but blockNum the same');
      }
      // Remaining cases (resolved below):
      //  * Case when the local firmcore is missing some confirmations needed to finalize
      //  * Case when we (local firmcore) are behind (not even aware of some blocks)
    } else {
      // Case when we don't even have this firmchain locally
      // We retrieve info from the deployment transaction, initialize existingChain
      await this._initFChainFromMounted(contract);
    }
    // TODO: should verify the blocks we are syncing with (the whole chain in local firmcore should be verified fully)
    //   - This will be done once we get proper EVM implementation in the browser
    //   - So for now every mounted chain is trusted

    const ch = this._st.chains[contract.address];
    const chain = assertDefined(ch, `${contract.address} chain should have been initialized in the state`);

    // TODO: It sounds like it is possible to filter for an array of event parameters: https://docs.ethers.org/v5/concepts/events/#events--filters
    // Should use this to filter only for confirmations of needed confirmers

    // Do this until chain.headBlockId matches headBlockId in the mounted chain 
    //  * Filter on BlockFinalized(chain.headBlockId);
    //  * Try getting Proposal or Execution event for that block to retrieve the actual block;
    //  * Collect confirmation events for that block;
    // Then collect BlockConfirmations, BlockFinalization, and BlockProposed events on the blocks after head block, store them;
    let lastBlockNum: number;
    do {
      const nPrevBlockId = chain.headBlockId;
      const nPrevBlockNum = assertDefined(this._st.blockNums[nPrevBlockId]);

      const header = assertDefined(await this._getNexFinalizedBlockHead(contract, nPrevBlockId));
      const bId = getBlockId(header);

      const prevBlock = this._st.blocks[nPrevBlockId];
      if (!isKnownBlock(prevBlock)) {
        throw new Error('Expected previous block to be known, because the next is finalized');
      }

      // Try to get the full block
      let bl = await this._getExecutedBlock(contract, bId);
      if (bl === undefined) {
        bl = await this._getProposedBlockM(contract, nPrevBlockId, bId);
      }

      // We know that we haven't reached the head yet.
      // So every block up to this point should have execute event triggered,
      // and therefore we should be able to retrieve full blocks
      // (block only becomes head block, once it is executed)
      if (bl === undefined) {
        throw new Error('When syncing up to head all blocks should be present (executed event should be signaled for all of them)');
      }

      // We know that if this block is finalized then previous block is executed.
      // Therefore, the previous confirmer set should be known.
      // FIXME: repetition
      const block = this._parseBlockValue(
        bl, prevBlock, contract
      );

      await this._createBlock(nPrevBlockId, block.messages, undefined, block);

      lastBlockNum = block.state.blockNum;

      // Collect confirmations for this block
      await this._collectConfirmationsFromMounted(contract, bId);
    } while (chain.headBlockId !== headBlId)

    return { status: 'insync', insyncBlocks: lastBlockNum };
  }

  async getChain(address: Address): Promise<MountedEFChain | undefined> {
    // this._getInitialized();

    const syncState = this._syncChainFc(address);

    const chain = this._st.chains[address];
    if (!chain) {
      return undefined;
    }

    const blockById: (id: BlockId) => Promise<EFBlock | undefined> = async (id: BlockId) => {
      const block = this._st.blocks[id];
      const height = this._st.blockNums[id];
      const messages = this._st.msgs[id];
      // console.log("blockById 1: ", block, "\n", height, "\n", messages);
      if (!block || height === undefined) {
        return undefined;
      }

      const isKnown = isKnownBlock(block);
      const prevBlockId = isKnown ? block.header.prevBlockId : block.header.prevBlockId;

      return {
        id,
        prevBlockId: ethers.utils.hexlify(prevBlockId),
        height,
        timestamp: isKnown ? BigNumber.from(block.header.timestamp).toNumber() : undefined,
        msgs: messages, 
        state: {
          confirmerSet: isKnown ? this._confirmerSetFromBlock(block) : undefined,
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
                if (prevBlockId === ZeroId) {
                  // Means it's the first block
                  resolve({
                    currentWeight: 0,
                    potentialWeight: 0,
                    threshold: 0,
                    final: true,
                  });
                } else {
                  const prevBlock = assertKnownBlock(this._st.blocks[utils.hexlify(prevBlockId)]);
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
            return this._accessState(chain, id, async (contract) => {
              const bn = await contract.getDelegate(weekIndex, roomNumber);
              const val = bn.toNumber();
              if (val === this.NullAccountId) {
                return undefined;
              } else {
                return val;
              }
            });
          },

          delegates: (weekIndex: number) => {
            return this._accessState(chain, id, async (contract) => {
              const bns = await contract.getDelegates(weekIndex);
              const rVals = bns.map((bn) => bn.toNumber());
              if (rVals.length === 0) {
                return undefined;
              } else {
                return rVals
              }             
            })
          },

          balance: (accId: AccountId) => {
            return this._accessState(chain, id, async (contract) => {
              const bn = await contract.balanceOfAccount(id);
              return bn.toNumber();
            });
          },

          balanceByAddr: (address: Address) => {
            return this._accessState(chain, id, async (contract) => {
              const bn = await contract.balanceOf(address);
              return bn.toNumber();
            });
          }, 

          totalSupply: () => {
            return this._accessState(chain, id, async (contract) => {
              const bn = await contract.totalSupply();
              return bn.toNumber();
            });
          },

          accountById: (accountId: AccountId) => {
            return this._accessState(chain, id, async () => {
              return await this._getAccountById(chain, accountId);
            });
          },

          accountByAddress: (address: Address) => {
            return this._accessState(chain, id, async (contract) => {
              const accountId = (await contract.byAddress(address)).toNumber();
              if (accountId === this.NullAccountId) {
                return undefined;
              }
              return await this._getAccountById(chain, accountId);
            });
          }, 

          directoryId: () => {
            return this._accessState(chain, id, async (contract) => {
              const dir = await contract.getDir();
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
          const bl = assertKnownBlock(this._st.blocks[prevBlock]);
          if (!bl) {
            throw new InvalidArgument("No block with this id");
          }

          const confSet = this.convertFcConfirmerSet(bl.state.confirmerSet);
          confMap = confSet.confirmers;
        } else {
          if (prevBlock.state.confirmerSet === undefined) {
            throw new Error('ConfirmerSet set in the previous block has to be known to create updateConfirmersMsg');
          }
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
        const bl = assertDefined(await this._createBlock(prevBlockId, messages, blockById));
        return bl;
      }
    }

    const getSlots = async (start?: number, end?: number) => {
      const ordBlocks = this._st.orderedBlocks[address];
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
      const ordBlocks = this._st.orderedBlocks[address];
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
        address,
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

    const efChain: MountedEFChain = {
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
      address,
      genesisBlockId: chain.genesisBlId,
      headBlockId: () => { return Promise.resolve(chain.headBlockId); },
      getSyncState: () => { return { status: 'behind', insyncBlocks: 0 }}
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