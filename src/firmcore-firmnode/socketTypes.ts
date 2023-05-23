import { AddressStr } from "firmcontracts/interface/types";

// TODO: better type
export type SocketError = Error;

export interface ServerToClientEvents {
}

export type ErrorCallback = (err: SocketError | undefined) => void;

export interface ClientToServerEvents {
  import: (
    to: AddressStr,
    carFile: Blob,
    callback: ErrorCallback
  ) => void;
}