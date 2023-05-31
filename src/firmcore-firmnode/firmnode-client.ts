import { AddressStr } from "firmcontracts/interface/types.js";
import { FirmnodeBlockstore } from "./blockstore.js";
import { CInputEncMsg, CInputEncMsgCodec, CInputMsgCodec, ContractMsg, Message, MessageCodec } from "./message.js";
import { FirmnodeSocket } from "./socketTypes.js";
import { isLeft } from "fp-ts/lib/Either.js";
import { NotFound } from "../exceptions/NotFound.js";
import { UnixFSEntry, UnixFSFile, exporter } from "ipfs-unixfs-exporter";
import { Type } from "io-ts";
import { TypeOf } from "io-ts";

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

  async readContractEntry(contractAddr: AddressStr, path: string): Promise<UnixFSEntry> {
    const cidStr = await this.getContractCID(contractAddr);

    const realPath = `${cidStr}/${path}`;

    return await exporter(realPath, this._blockstore);
  }

  async readContractUnixfsFile(contractAddr: AddressStr, path: string): Promise<UnixFSFile> {
    const entry = await this.readContractEntry(contractAddr, path);

    if (entry.type !== 'file') {
      throw new Error(`Expected a file at ${path}`)
    }

    return entry;
  }

  async readContractFileStr(contractAddr: AddressStr, path: string): Promise<string> {
    const file = await this.readContractUnixfsFile(contractAddr, path);

    // TODO: write custom codec to do this all at once
    const decoder = new TextDecoder();
    let str: string = '';
    for await (const chunk of file.content()) {
      str += decoder.decode(chunk);
    }

    return str;
  }

  async readContractObject(contractAddr: AddressStr, path: string): Promise<unknown> {
    const str = await this.readContractFileStr(contractAddr, path);

    return JSON.parse(str);
  }

  async readContractTyped<A>(
    contractAddr: AddressStr, path: string, codec: Type<A>
  ): Promise<A> {
    const obj = await this.readContractObject(contractAddr, path);

    const dec = codec.decode(obj);

    if (isLeft(dec)) {
      throw new Error(`Unable to decode: ${path}, as ${codec.name}`);
    }

    return dec.right;
    
  }

  async readContractMsg(contractAddr: AddressStr, path: string): Promise<Message> { 
    return this.readContractTyped(
      contractAddr, path, MessageCodec
    );
  }

  async readContractInput(contractAddr: AddressStr, path: string): Promise<ContractMsg> {
    return this.readContractTyped(contractAddr, path, CInputMsgCodec);
  }

  async readContractInputEnc(contractAddr: AddressStr, path: string): Promise<CInputEncMsg> {
    return this.readContractTyped(contractAddr, path, CInputEncMsgCodec);
  }
}