import { CID, create, IPFSHTTPClient } from 'kubo-rpc-client';
import { CarFileInfo } from '../helpers/car.js';
import { CIDStr } from '../ifirmcore/index.js';
import { arrayToRecord } from '../helpers/toRecord.js';

export interface Tag {
  name: string,
  cidStr: CIDStr
}

export type TagsByName = Record<string, Tag>;
export type TagsByCID = Record<CIDStr, Tag>

export class FilesTagger {
  protected _ipfsClient: IPFSHTTPClient;
  protected readonly _pathPrefix = '/.firm';

  constructor() {
    this._ipfsClient = create({
      url: 'http://127.0.0.1:5001/api/v0'
    });
  }

  // async getEntryStat(address: string) {
  //   const normAddr = normalizeHexStr(address);
  //   try {
  //     const stat = await this._ipfsClient.files.stat(`/.firm/${normAddr}`);
  //     return stat;
  //   } catch (err) {
  //     console.log(`Cant get entry ${normAddr}:`, err);
  //     return undefined;
  //   }
  // }

  /**
   * @returns {string} CIDv0 string
   */
  private async _importCAR(car: CarFileInfo): Promise<string> {
    const options = { pinRoots: false };
    for await (const v of this._ipfsClient.dag.import(car.parts, options)) {
      console.log('CAR import: ', v);
    }
    const cidStr = car.rootCID.toV0().toString();
    return cidStr;
  }

  async createTag(tagName: string, car: CarFileInfo): Promise<void> {
    const cidStr = await this._importCAR(car);

    const firmPath = `${this._pathPrefix}/${tagName}`
    try {
      await this._ipfsClient.files.cp(
        // eslint-disable-next-line @typescript-eslint/restrict-plus-operands
        '/ipfs/' + cidStr,
        firmPath,
        {
          parents: true,
          cidVersion: 0
        }
      );
    } catch (err: any) {
      console.error('err: ', err);
      throw err;
    }

    console.log(`tagged: ${cidStr} to ${firmPath}`);
  }

  /**
   * Updates tag if it already exists, otherwise creates a new one.
   */
  async setTag(tagName: string, car: CarFileInfo): Promise<void> {
    const firmPath = `${this._pathPrefix}/${tagName}`;
    try {
      await this._ipfsClient.files.rm(
        firmPath,
        { recursive: true }
      );
      console.log('Updating a tag: ', tagName);
    } catch (err: any) {
      console.log('Creating a new tag: ', tagName);
    }

    await this.createTag(tagName, car);
  }

  async getTag(tagName: string): Promise<Tag> {
    const firmPath = `${this._pathPrefix}/${tagName}`;
    try {
      const stat = await this._ipfsClient.files.stat(firmPath);
      return {
        name: tagName,
        cidStr: stat.cid.toV0().toString(),
      }
    } catch (err: any) {
      console.error('Error getting a tag: ', err);
      throw err;
    }
  }

  async ls(): Promise<Tag[]> {
    const resp = await this._ipfsClient.files.ls(this._pathPrefix);
    const tags: Tag[] = [];
    for await (const item of resp) {
      const cid = item.cid as CID;
      tags.push({ cidStr: cid.toV0().toString(), name: item.name });
    }
    return tags;
  }

  async lsByName(): Promise<TagsByName> {
    const list = await this.ls();
    return arrayToRecord(list, 'name');
  }

  async lsByCID(): Promise<TagsByCID> {
    const list = await this.ls();
    return arrayToRecord(list, 'cidStr');
  }

  async getCAR(cidStr: CIDStr): Promise<AsyncIterable<Uint8Array>> {
    const cid = CID.parse(cidStr);
    const resp = await this._ipfsClient.dag.export(cid) as AsyncIterable<Uint8Array>;
    return resp;
  }

  async getTaggedAsCAR(tag: Tag): Promise<AsyncIterable<Uint8Array>> {
    return this.getCAR(tag.cidStr);
  }

}