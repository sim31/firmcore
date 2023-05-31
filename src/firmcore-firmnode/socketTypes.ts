import { AddressStr } from "firmcontracts/interface/types.js";
import { CID } from '@ipld/car/iterator';
import { Message } from "./message.js";
import { ethers } from "ethers";
import { txApplied } from "../helpers/transactions.js";
import { Overwrite } from "utility-types";
import { Either } from "fp-ts/lib/Either.js";
import { Socket } from 'socket.io-client';
import { Required } from "utility-types";

export interface ImportResult {
  roots: CID[];
}

// TODO: better type
export type SocketError = string;

export interface ServerToClientEvents {
}

export type ImportCallback = (res: SocketError | ImportResult) => void;
// export type SendCallback = (res: )

export function isError(res: SocketError | ImportResult): res is SocketError {
  return typeof res === 'string';
}

export interface CreatedContract {
  address: AddressStr,
  belowCIDStr: string | null,
}

export type CreatedContractFull = Overwrite<CreatedContract, { belowCIDStr: string }>;

// TODO: Refactor to use Either?
export type SendError = string;
export type SendResult = {
  cidStr?: string,
  error?: SendError,
  txReceipt?: ethers.providers.TransactionReceipt,
  contractsCreated?: CreatedContract[],
  belowCIDStr?: string,
}
export type SendSuccess = Omit<SendResult, 'error'>;
export type SendInputApplied = Required<SendSuccess, 'txReceipt'>;

export type SendCallback = (res: SendResult) => void;

export type GetPathCIDError = string;
// errror (left) or cid (right)
export type GetPathCIDResult = Either<GetPathCIDError, string>
export type GetPathCIDCallback = (res: GetPathCIDResult) => void;

// export type GetIPBlockError = string
// export GetBlockResult = Either<GetIPBlockError, 

export type GetIPBlockStatErr = string;
export type GetIPBlockStatResult = Either<GetIPBlockStatErr, any>;
export type GetIPBlockStatCb = (res: GetIPBlockStatResult) => void;

export type GetIPBlockErr = string;
export type GetIPBlockResult = Either<GetIPBlockErr, ArrayBuffer>;
export type GetIPBlockCb = (res: GetIPBlockResult) => void;

export function resIsAppliedTx(res: SendResult): res is SendInputApplied {
  return res.txReceipt ? txApplied(res.txReceipt) : false;
}

export interface ClientToServerEvents {
  import: (
    to: AddressStr,
    carFile: BlobPart[],
    callback: ImportCallback
  ) => void;

  send: (
    msg: Message,
    callback: SendCallback
  ) => void;

  getPathCID: (
    address: AddressStr,
    subPath: string,
    callback: GetPathCIDCallback
  ) => void

  getIPBlockStat: (
    cidStr: string,
    callback: GetIPBlockStatCb
  ) => void

  getIPBlock: (
    cidStr: string,
    callback: GetIPBlockCb
  ) => void
}

export type FirmnodeSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
