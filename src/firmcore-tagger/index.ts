import { CID, create, IPFSHTTPClient } from 'kubo-rpc-client';
import { CarFileInfo } from '../helpers/car.js';

export class FirmcoreTagger {
  protected _ipfsClient: IPFSHTTPClient;

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

  async tag(tag: string, car: CarFileInfo): Promise<void> {
    const options = { pinRoots: false };
    for await (const v of this._ipfsClient.dag.import(car.parts, options)) {
      console.log('CAR import: ', v);
    }

    const cidStr = car.rootCID.toV0().toString();
    const firmPath = `/.firm/${tag}`

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

}