import { Overwrite, Required } from 'utility-types';
import { IWallet } from '../iwallet';

export type Address = string;
export type BlockId = string;
export type IPFSLink = string;
export type AccountId = number;
export type IPNSAddress = string;
export type TelegramUsername = string;
export type PlatformId = string;
export type PlatformAccountId = string;
export type TokenBalance = number;
export type OptAccountId = AccountId | undefined;
export type Timestamp = Date;
export type TimestampPOD = number;

export interface Confirmer {
  address: Address;
  weight: number;
}
export function newConfirmer(address: Address, weight: number = 1): Confirmer {
  return { address, weight };
}

export type ConfirmerMap = Record<Address, Confirmer>;

export interface ConfirmerSet {
  confirmers: ConfirmerMap;
  threshold: number;
}

export interface Chain {
  readonly address: Address;
  name?: string;
  symbol?: string;
  genesisBlockId: BlockId;

  headBlockId: () => Promise<BlockId>;

  //getBlock(id: BlockId): Promise<Blo
}

export interface ConfirmationStatus {
  currentWeight: number,
  potentialWeight: number,
  threshold: number,
  final: boolean;
}

export interface ChainState {
  confirmerSet: ConfirmerSet; // This defines requirements for confirming the next block
  confirmations: Address[];   // These are confirmations of this block
  confirmationStatus: ConfirmationStatus; // This is confirmation status of this block
}

export interface ChainAccessor {
  confirmerSet: ConfirmerSet;
  confirmations: () => Promise<Address[]>;
  confirmationStatus: () => Promise<ConfirmationStatus>;
}

export interface RespectChain extends Chain {
  name: string;
  symbol: string;
}

export interface DirectoryState extends ChainState {
  directoryId: IPFSLink | undefined;
}

export interface DirectoryAccessor extends ChainAccessor {
  directoryId(): Promise<IPFSLink | undefined>;
  // TODO: Function to get the actual directory
}

export type ExtAccountMap = Record<PlatformId, PlatformAccountId>; 

export interface Account {
  id: AccountId;
  address?: Address;
  name?: string;
  extAccounts: ExtAccountMap;
}
export function newAccount(
  extAccounts: ExtAccountMap,
  address?: Address,
  name?: string,
  id?: AccountId,
): Account {
  return { id: id ?? 0, address, name, extAccounts };
}

export interface FirmAccountSystemState extends ChainState {
  accountById?: Record<AccountId, Account>;
  accountByAddress?: Record<Address, AccountId>;
}

// Partial state: might not contain all entries
export interface FirmAccountSystemAccessor extends ChainAccessor {
  accountById(id: AccountId): Promise<Account | undefined>;  
  accountByAddress(address: Address): Promise<Account | undefined>;
}

export interface RespectState extends FirmAccountSystemState {
  balances?: Record<AccountId, TokenBalance>;
  totalSupply?: TokenBalance;
}

export interface RespectAccessor extends FirmAccountSystemAccessor {
  balance(id: AccountId): Promise<TokenBalance>;
  balanceByAddr(address: Address): Promise<TokenBalance>;
  totalSupply(): Promise<TokenBalance>;
}

// TODO: types for making actions on a chain

export interface FractalBreakoutResult {
  ranks: readonly [OptAccountId, OptAccountId, OptAccountId, OptAccountId, OptAccountId, OptAccountId];
}
export function newFractalBreakoutResult(
  rank1?: AccountId, rank2?: AccountId, rank3?: AccountId,
  rank4?: AccountId, rank5?: AccountId, rank6?: AccountId,
): FractalBreakoutResult {
  return { ranks: [rank1, rank2, rank3, rank4, rank5, rank6] };
}

export interface EFBreakoutResults extends FractalBreakoutResult {
  delegate: AccountId;
}
export function newEFBreakoutResults(
  delegate: AccountId,
  rank1?: AccountId, rank2?: AccountId, rank3?: AccountId,
  rank4?: AccountId, rank5?: AccountId, rank6?: AccountId,
): EFBreakoutResults {
  return {
    delegate,
    ranks: [rank1, rank2, rank3, rank4, rank5, rank6]
  };
}

export type RoomNumber = number;
export const weekIndices = [0, 1, 2, 3] as const;
export type WeekIndex = typeof weekIndices[number];
export type Delegates = Record<WeekIndex, Record<RoomNumber, AccountId> | undefined>;
const emptyDelegates: Delegates = {
  0: undefined, 1: undefined, 2: undefined, 3: undefined,
};

export interface EFChainState extends RespectState, DirectoryState {
  delegates: Delegates;
}

export interface EFChainAccessor extends RespectAccessor, DirectoryAccessor {
  // Active delegates
  // Week index 0-3, with 0 being the newest
  delegate(weekIndex: WeekIndex, roomNumber: Number): Promise<AccountId | undefined>;
  delegates(weekIndex: WeekIndex): Promise<AccountId[] | undefined>;
}

export interface Msg {
  readonly name: string;
}

export interface EFSubmitResultsMsg extends Msg {
  readonly name: 'efSubmitResults';
  results: EFBreakoutResults[];
}
export function newEFSubmitResultsMsg(results: EFBreakoutResults[]): EFSubmitResultsMsg {
  return { name: 'efSubmitResults', results };
}

export interface SetDirMsg extends Msg {
  readonly name: 'setDir';
  dir: IPFSLink;
}
export function newSetDirMsg(dir: IPFSLink): SetDirMsg {
  return { name: 'setDir', dir };
}

export type ConfirmerOpId = 'add' | 'remove';

export interface ConfirmerOp {
  opId: ConfirmerOpId;
  confirmer: Confirmer;
}

export interface AddConfirmerOp extends ConfirmerOp {
  opId: 'add';
}

export interface RemoveConfirmerOp extends ConfirmerOp {
  opId: 'remove';
}

export function newAddConfirmerOp(confirmer: Confirmer): AddConfirmerOp {
  return { opId: 'add', confirmer };
}
export function newRemoveConfirmerOp(confirmer: Confirmer): RemoveConfirmerOp {
  return { opId: 'remove', confirmer };
}

export interface UpdateConfirmersMsg extends Msg {
  readonly name: 'updateConfirmers';
  ops: ConfirmerOp[];
  threshold: number;
}

export interface CreateAccountMsg extends Msg {
  readonly name: 'createAccount';
  account: Account;
}
export function newCreateAccountMsg(account: Account): CreateAccountMsg {
  return { name: 'createAccount', account };
}

export interface RemoveAccountMsg extends Msg {
  readonly name: 'removeAccount';
  accountId: AccountId;
}
export function newRemoveAccountMsg(accountId: AccountId): RemoveAccountMsg {
  return { name: 'removeAccount', accountId };
}

export interface UpdateAccountMsg extends Msg {
  readonly name: 'updateAccount';
  accountId: AccountId;
  newAccount: Account;
}
export function newUpdateAccountMsg(accountId: AccountId, newAccount: Account): UpdateAccountMsg {
  return { name: 'updateAccount', accountId, newAccount };

}

export type EFMsg =
  CreateAccountMsg | RemoveAccountMsg | UpdateAccountMsg | 
  UpdateConfirmersMsg | SetDirMsg | EFSubmitResultsMsg;

export interface EFBlock {
  id: BlockId;
  prevBlockId: BlockId;
  height: number;
  timestamp: Date;
  msgs: EFMsg[];
  state: EFChainAccessor;
}

export type EFBlockPOD = Overwrite<EFBlock, { state: EFChainState }>;

export interface EFBlockBuilder {
  // Creates an publishes the block
  createBlock(prevBlockId: BlockId, msgs: EFMsg[]): Promise<EFBlock>;

  // Should automatically set the threshold
  createUpdateConfirmersMsg(
    prevBlock: BlockId | EFBlock | EFBlockPOD,
    confirmerOps: ConfirmerOp[]
  ): Promise<UpdateConfirmersMsg>;
}

export interface BlockConfirmer {
  address: Address;
  confirm(blockId: BlockId): Promise<void>;
}

export type AccountWithAddress = Required<Account, 'address'>;
export function newAccountWithAddress(
  extAccounts: ExtAccountMap,
  address: Address,
  name?: string,
  id?: AccountId,
): AccountWithAddress {
  return { id: id ?? 0, address, name, extAccounts };
}

export interface EFConstructorArgs {
  confirmers: AccountWithAddress[];
  name: string;
  symbol: string;
  threshold?: number;
}

export function newEFConstructorArgs(
  confirmers: AccountWithAddress[],
  name: string,
  symbol: string,
  threshold?: number,
): EFConstructorArgs {
  return { confirmers, name, symbol, threshold };
}


export interface EFChainPODSlice extends Omit<RespectChain, 'headBlockId'> {
  constructorArgs: EFConstructorArgs;
  blocks: EFBlockPOD[];
}

export interface EFChain extends RespectChain {
  constructorArgs: EFConstructorArgs;
  builder: EFBlockBuilder;

  blockById(id: BlockId): Promise<EFBlock | undefined>;
  
  getSlice(start?: number, end?: number): Promise<EFBlock[]>;

  getPODChain(start?: number, end?: number): Promise<EFChainPODSlice>;
}

export async function getAllDelegates(block: EFBlock): Promise<Delegates> {
  const del: Delegates = emptyDelegates;
  for (const weekIndex of weekIndices) {
    const accountIds = await block.state.delegates(weekIndex);    
    if (accountIds) {
      del[weekIndex] = accountIds.reduce((prevValue, id, index) => {
        prevValue[index] = id;
        return prevValue;
      }, {} as Record<RoomNumber, AccountId>);
    }
  }
  return del;
}

export async function toEFBlockPOD(block: EFBlock): Promise<EFBlockPOD> {
  const state: EFChainState = {
    delegates: await getAllDelegates(block),
    confirmerSet: block.state.confirmerSet,
    confirmations: await block.state.confirmations(),
    confirmationStatus: await block.state.confirmationStatus(),
    directoryId: await block.state.directoryId(),
  }

  return { ...block, state };
}

export async function toEFChainPODSlice(
  chain: EFChain,
  sliceStart: number,
  sliceEnd: number
): Promise<EFChainPODSlice> {
  const slice = await chain.getSlice(sliceStart, sliceEnd);
  const blockPods: EFBlockPOD[] = [];
  for (const block of slice) {
    blockPods.push(await toEFBlockPOD(block));
  }
  return {
    constructorArgs: chain.constructorArgs,
    blocks: blockPods,
    symbol: chain.symbol,
    address: chain.address,
    name: chain.name,
    genesisBlockId: chain.genesisBlockId,
  };
}

export interface IFirmCore {
  readonly NullAddr: Address;
  readonly NullBlockId: BlockId;
  readonly NullAccountId: AccountId;

  init(): Promise<void>;
  shutDown(): Promise<void>;
  createEFChain(args: EFConstructorArgs): Promise<EFChain>;
  getChain(address: Address): Promise<EFChain | undefined>;
  createWalletConfirmer(wallet: IWallet): Promise<BlockConfirmer>;

  // Helpers for testing
  randomAddress(): Address;
  randomBlockId(): BlockId;
  randomIPFSLink(): IPFSLink;
}