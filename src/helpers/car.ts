import { CarWriter } from '@ipld/car/writer'
import { importer, type FileCandidate, type DirectoryCandidate, ImportResult } from 'ipfs-unixfs-importer'
import { MemoryBlockstore } from 'blockstore-core';
import { CID } from 'multiformats';
import stringify from 'json-stable-stringify-without-jsonify';
import * as cidPkg from 'firmcontracts/interface/cid.js';

const { cid0ToBytes32Str } = cidPkg;

export type FsEntries = Array<FileCandidate | DirectoryCandidate>;

export async function getFileCID(file: FileCandidate) {
  const blockstore = new MemoryBlockstore();

  let rootEntry: ImportResult | undefined;
  for await (const entry of importer([file], blockstore)) {
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

export function objectToFile(obj: Record<string, unknown>): FileCandidate {
  const encoder = new TextEncoder();
  const file = {
    content: encoder.encode(stringify(obj, { space: 2 }))
  };
  return file;
}

export function anyToFile(obj: any): FileCandidate {
  const encoder = new TextEncoder();
  const file = {
    content: encoder.encode(stringify(obj, { space: 2 }))
  };
  return file;
}

interface CarFileInfo {
  parts: BlobPart[],
  entries: ImportResult[],
}

export async function createCARFile(entries: FsEntries): Promise<CarFileInfo> {
  const blockstore = new MemoryBlockstore();

  const importedEntries: ImportResult[] = [];
  for await (const entry of importer(entries, blockstore)) {
    importedEntries.push(entry);
  }

  const rootEntry = importedEntries[importedEntries.length];
  if (rootEntry !== undefined) {
    const c = rootEntry.cid;
    const rootCID = new CID(
      c.version, c.code, c.multihash, c.bytes
    );
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

    return { parts: carParts, entries: importedEntries };
    // return new Blob(carParts, {
    //   type: 'application/car',
    // });
  } else {
    throw new Error('Unable to determine import into unixfs');
  }
}