import { AddressStr } from "firmcontracts/interface/types.js";
import { CID } from '@ipld/car/iterator';
import { Message } from "./message.js";
import { ethers } from "ethers";
import { txApplied } from "../helpers/transactions.js";

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

export type SendError = string;
export type SendResult = {
  cidStr?: string,
  error?: SendError,
  txReceipt?: ethers.providers.TransactionReceipt,
  contractsCreated?: AddressStr[]
}
export type SendCallback = (res: SendResult) => void;

export function resIsAppliedTx(res: SendResult): boolean {
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
}