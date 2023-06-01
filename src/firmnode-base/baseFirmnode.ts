import { AddressStr } from "firmcontracts/interface/types.js";
import { isLeft } from "fp-ts/lib/Either.js";
import { Type } from "io-ts";
import { UnixFSEntry, UnixFSFile, exporter } from "ipfs-unixfs-exporter";
import { CInputEncMsg, CInputEncMsgCodec, CInputMsgCodec, ContractMsg, Message, MessageCodec } from "./message.js";
import { FsEntries, createCARFile } from "../helpers/car.js";
import { ImportResult } from "ipfs-unixfs-importer";
import { ethers } from "ethers";
import { Overwrite, Required } from "utility-types";
import { txApplied } from "../helpers/transactions.js";

export interface CreatedContract {
  address: AddressStr,
  belowCIDStr: string | null,
}

export type CreatedContractFull = Overwrite<CreatedContract, { belowCIDStr: string }>;

export interface SendResult {
  cidStr: string,
  belowCIDStr: string,
  txReceipt?: ethers.providers.TransactionReceipt,
  contractsCreated?: CreatedContract[],
}

export type CInputResult = Required<SendResult, 'txReceipt'>;

export function isCInputResult(res: SendResult): res is CInputResult {
  return res.txReceipt ? txApplied(res.txReceipt) : false;
}

export type EntryImportResult = ImportResult;

export abstract class BaseFirmnode {
  abstract getContractCID(address: AddressStr): Promise<string>;

  abstract readEntry(contractAddr: AddressStr, path: string): Promise<UnixFSEntry>;

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

  abstract importEntries(contractAddr: AddressStr, fsEntries: FsEntries): Promise<EntryImportResult[]>;

  abstract send(msg: Message): Promise<SendResult>;

  async sendContractInput(msg: ContractMsg): Promise<CInputResult> {
    const res = await this.send(msg);
    if (isCInputResult(res)) {
      return res;
    } else {
      throw new Error(`Failed to apply: ${msg}`);
    }
  }

  abstract getIPBlockStat(cidStr: string): Promise<any>;
  abstract getIPBlock(cidStr: string): Promise<Uint8Array>;
}