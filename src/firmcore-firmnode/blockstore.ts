import { BaseBlockstore } from "blockstore-core";
import { AbortOptions, Await } from "interface-store";
import { CID } from "multiformats";
import { FirmnodeSocket } from "./socketTypes.js";
import { isLeft } from "fp-ts/lib/Either.js";

export class FirmnodeBlockstore extends BaseBlockstore {
  private _socket: FirmnodeSocket;

  constructor(socket: FirmnodeSocket) {
    super();

    this._socket = socket;
  }

  // TODO: implement writes as well?

  override has(key: CID): Await<boolean> {
    const promise = new Promise<boolean>((resolve, reject) => {
      this._socket.emit('getIPBlockStat', key.toV0().toString(), (res) => {
        if (isLeft(res)) {
          const err = res.left;
          const errStr = `Error accessing block ${key}: ${err}`;
          console.log(errStr);
          // TODO: detect error
          resolve(false);
        } else {
          resolve(true);
        }
      })
    })

    return promise;
  }

  override get(key: CID): Await<Uint8Array> {
    const promise = new Promise<Uint8Array>((resolve, reject) => {
      this._socket.emit('getIPBlock', key.toV0().toString(), (res) => {
        if (isLeft(res)) {
          const err = res.left;
          const errStr = `Error accessing block ${key}: ${err}`;
          console.log(errStr);
          reject(new Error(errStr));
        } else {
          // console.log('retrieving: ', key, 'value: ', res.right);
          resolve(new Uint8Array(res.right));
        }
      })
    })

    return promise;
  }
  
}