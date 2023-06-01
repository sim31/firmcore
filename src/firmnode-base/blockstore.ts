import { BaseBlockstore } from "blockstore-core";
import { Await } from "interface-store";
import { CID } from "multiformats";
import { BaseFirmnode } from './baseFirmnode.js';

export class FirmnodeBlockstore extends BaseBlockstore {
  private _fn: BaseFirmnode

  constructor(firmnode: BaseFirmnode) {
    super();
    this._fn = firmnode
  }

  override has(key: CID): Await<boolean> {
    return this._fn.getIPBlockStat(key.toV0().toString()).then(
      () => {
        return true;
      },
      () => {
        return false;
      }
    );
  }

  override get(key: CID): Await<Uint8Array> {
    return this._fn.getIPBlock(key.toV0().toString());
  }
}