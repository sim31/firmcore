import { AddressStr } from "firmcontracts/interface/types.js";
import { FirmnodeBlockstore } from "./blockstore.js";
import { CInputEncMsg, CInputEncMsgCodec, CInputMsgCodec, ContractMsg, Message, MessageCodec } from "./message.js";
import { FirmnodeSocket, SendInputApplied, SendResult, SendSuccess, isError, resIsAppliedTx } from "./socketTypes.js";
import { isLeft } from "fp-ts/lib/Either.js";
import { NotFound } from "../exceptions/NotFound.js";
import { UnixFSEntry, UnixFSFile, exporter } from "ipfs-unixfs-exporter";
import { Type } from "io-ts";
import { TypeOf } from "io-ts";
import { FsEntries, createCARFile } from "../helpers/car.js";
import { ImportResult } from "ipfs-unixfs-importer";

export class FirmnodeClient {
  private _socket: FirmnodeSocket;
  private _blockstore: FirmnodeBlockstore

  constructor(socket: FirmnodeSocket) {
    this._socket = socket;
    this._blockstore = new FirmnodeBlockstore(socket);
  }

  async getContractCID(address: AddressStr): Promise<string> {
    const promise = new Promise<string>((resolve, reject) => {
      this._socket.emit('getPathCID', address, '', async (res) => {
        if (isLeft(res)) {
          throw new NotFound(`Firmnode cannot retrieve the chain: ${res.left}`)
        }
        resolve(res.right);
        // this._setChainCache(chainAddr, cache);
      });
    })

    return promise;
  }

  async readEntry(contractAddr: AddressStr, path: string): Promise<UnixFSEntry> {
    const cidStr = await this.getContractCID(contractAddr);

    const realPath = `${cidStr}/${path}`;

    return await exporter(realPath, this._blockstore);
  }

  async readUnixfsFile(contractAddr: AddressStr, path: string): Promise<UnixFSFile> {
    const entry = await this.readEntry(contractAddr, path);

    if (entry.type !== 'file') {
      throw new Error(`Expected a file at ${path}`)
    }

    return entry;
  }

  async readFileStr(contractAddr: AddressStr, path: string): Promise<string> {
    const file = await this.readUnixfsFile(contractAddr, path);

    // TODO: write custom codec to do this all at once
    const decoder = new TextDecoder();
    let str: string = '';
    for await (const chunk of file.content()) {
      str += decoder.decode(chunk);
    }

    return str;
  }

  async readObject(contractAddr: AddressStr, path: string): Promise<unknown> {
    const str = await this.readFileStr(contractAddr, path);

    return JSON.parse(str);
  }

  async readTyped<A>(
    contractAddr: AddressStr, path: string, codec: Type<A>
  ): Promise<A> {
    const obj = await this.readObject(contractAddr, path);

    const dec = codec.decode(obj);

    if (isLeft(dec)) {
      throw new Error(`Unable to decode: ${path}, as ${codec.name}`);
    }

    return dec.right;
    
  }

  async readContractMsg(contractAddr: AddressStr, path: string): Promise<Message> { 
    return this.readTyped(
      contractAddr, path, MessageCodec
    );
  }

  async readContractInput(contractAddr: AddressStr, path: string): Promise<ContractMsg> {
    return this.readTyped(contractAddr, path, CInputMsgCodec);
  }

  async readContractInputEnc(contractAddr: AddressStr, path: string): Promise<CInputEncMsg> {
    return this.readTyped(contractAddr, path, CInputEncMsgCodec);
  }

  async importEntries(contractAddr: AddressStr, fsEntries: FsEntries): Promise<ImportResult[]> {
    const { parts, entries } = await createCARFile(fsEntries);

    const importPromise = new Promise((resolve, reject) => {
      this._socket.emit('import', contractAddr, parts, (res) => {
        if (isError(res)) {
          console.error('Failed importing: ', res);
          reject(res);
        } else {
          console.log('import result: ', res.roots);
          resolve(res);
        }
      });
    });
    await importPromise;

    return entries;
  }

  async send(msg: Message): Promise<SendSuccess> {
    const sendPromise = new Promise<SendSuccess>((resolve, reject) => {
      this._socket.emit('send', msg, (result) => {
        if (result.error !== undefined) {
          reject(`Error response sending ${msg}\n Error: ${result.error}`);
        } else {
          resolve(result);
        }
      });
    });
    return sendPromise;
  }

  async sendContractInput(msg: ContractMsg): Promise<SendInputApplied> {
    const res = await this.send(msg);
    if (resIsAppliedTx(res)) {
      return res;
    } else {
      throw new Error(`Failed to apply: ${msg}`);
    }

  }
}