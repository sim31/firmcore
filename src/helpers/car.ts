import { CarWriter } from '@ipld/car/writer'
import { importer, type FileCandidate, type DirectoryCandidate, ImportResult, ImporterOptions } from 'ipfs-unixfs-importer'
import { exporter, UnixFSEntry, UnixFSFile } from 'ipfs-unixfs-exporter';
import { MemoryBlockstore } from 'blockstore-core';
import { CID } from 'multiformats';
import stringify from 'json-stable-stringify-without-jsonify';
import * as cidPkg from 'firmcontracts/interface/cid.js';
import { ProgrammingError } from '../exceptions/ProgrammingError.js';
import { CarReader } from '@ipld/car';
import toIt from 'browser-readablestream-to-it'
import { InvalidArgument } from '../exceptions/InvalidArgument.js';
import { Overwrite } from 'utility-types';

const { cid0ToBytes32Str } = cidPkg;

export type MTime = NonNullable<FileCandidate['mtime']>;

export type FsEntries = Array<FileCandidate | DirectoryCandidate>;

const importOptions: ImporterOptions = {
  rawLeaves: false,
  reduceSingleLeafToSelf: false,
  cidVersion: 0
}

export async function getFileCID(file: FileCandidate) {
  const blockstore = new MemoryBlockstore();

  let rootEntry: ImportResult | undefined;
  for await (const entry of importer([file], blockstore, importOptions)) {
    rootEntry = entry;
  }

  return rootEntry?.cid;
}

export async function getFileCIDBytes(file: FileCandidate) {
  const cid = await getFileCID(file);
  if (cid === undefined) {
    throw new Error(`Unable to get cid of ${file.path}`);
  }
  const cidBytes = cid0ToBytes32Str(cid.toV0().toString());
  return cidBytes;
}

export function getImportedCID(results: ImportResult[], entryPath: string) {
  const entry = results.find(res => res.path === entryPath);
  if (entry === undefined) {
    throw new ProgrammingError('Entry not found in the import results');
  }

  return entry.cid.toV0();
}

export function getImportedCIDBytes(results: ImportResult[], entryPath: string) {
  const entry = results.find(res => res.path === entryPath);
  if (entry === undefined) {
    throw new ProgrammingError('Entry not found in the import results');
  }

  return cid0ToBytes32Str(entry.cid.toV0().toString());
}

export interface FileOptions {
  mtime?: MTime,
  mode?: number
}

export function objectToFile(obj: Record<string, unknown>, options?: FileOptions): FileCandidate {
  const encoder = new TextEncoder();
  const file = {
    content: encoder.encode(stringify(obj, { space: 2 })),
    ...options
  };
  return file;
}

export async function objectToCAR(
  obj: Record<string, unknown>,
  options: CarOptions = { wrapInDir: false }
): Promise<CarFileInfo> {
  const file = objectToFile(obj);
  return await createCARFile([file], options);
}

export async function anyToCAR(
  a: any,
  options: CarOptions = { wrapInDir: false }
): Promise<CarFileInfo> {
  const file = anyToFile(a);
  return await createCARFile([file], options);
}


export function anyToFile(obj: any): FileCandidate {
  const encoder = new TextEncoder();
  const file = {
    content: encoder.encode(stringify(obj, { space: 2 }))
  };
  return file;
}

export interface CarFileInfo {
  parts: Uint8Array[],
  entries: ImportResult[],
  rootCID: CID
}

type CarOptions = {
  wrapInDir?: boolean
}

export async function createCARFile(
  entries: FsEntries,
  options?: CarOptions
): Promise<CarFileInfo> {
  const blockstore = new MemoryBlockstore();

  const importedEntries: ImportResult[] = [];
  const opts = options?.wrapInDir === undefined || options.wrapInDir ?
    { ...importOptions, wrapWithDirectory: true }
    : importOptions;

  for await (const entry of importer(entries, blockstore, opts)) {
    importedEntries.push(entry);
  }

  const rootEntry = importedEntries[importedEntries.length-1];
  if (rootEntry !== undefined) {
    const rootCID = rootEntry.cid;
    console.log('root CID: ', rootCID.toString());

    const { writer, out } = CarWriter.create(rootCID);
    for await (const block of blockstore.getAll()) {
      writer.put({ 
        cid: block.cid,
        bytes: block.block
      });
    }
    writer.close()

    const carParts = new Array<Uint8Array>();
    for await (const chunk of out) {
      carParts.push(chunk)
    }

    return { parts: carParts, entries: importedEntries, rootCID };
    // return new Blob(carParts, {
    //   type: 'application/car',
    // });
  } else {
    throw new Error('Unable to determine import into unixfs');
  }
}

export async function readCARFile(carFile: AsyncIterable<Uint8Array>): Promise<UnixFSEntry> {
  // const it = toIt(carFile);

  const reader = await CarReader.fromIterable(carFile);

  const roots = await reader.getRoots();
  if (roots.length !== 1) {
    throw new ProgrammingError('This CAR file should have one root');
  }
  const root = roots[0]!;

  const blockstore = new MemoryBlockstore();

  for await (const block of reader.blocks()) {
    // TODO: they should fix the typings
    blockstore.put(block.cid, block.bytes);
  }

  return await exporter(root, blockstore);
}

export async function unixfsFileToObj(entry: UnixFSFile) {
  const decoder = new TextDecoder();
  let str = '';
  for await (const chunk of entry.content()) {
    str += decoder.decode(chunk, { stream: true });
  }
  return JSON.parse(str);
}

export async function logTree(rootEntry: UnixFSEntry) {
  console.log('tree: ', rootEntry.name);
  if (rootEntry.type === 'file') {
    // TODO: how to convert these chunks to text...
    for await (const chunk of rootEntry.content()) {
      // console.log(chunk)
    }
  } else if (rootEntry.type === 'directory') {
    for await (const entry of rootEntry.content()) {
      await logTree(entry);
    }
  }
}
