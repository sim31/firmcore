import { AddressStr } from "firmcontracts/interface/types";
import { CID } from '@ipld/car/types/api';

export interface ImportResult {
  roots: CID[];
}

// TODO: better type
export type SocketError = string;

export interface ServerToClientEvents {
}

export type ErrorCallback = (res: SocketError | ImportResult) => void;

export function isError(res: SocketError | ImportResult): res is SocketError {
  return typeof res === 'string';
}

export interface ClientToServerEvents {
  import: (
    to: AddressStr,
    carFile: BlobPart[],
    callback: ErrorCallback
  ) => void;
}