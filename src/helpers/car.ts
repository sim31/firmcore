import { CarWriter } from '@ipld/car/writer'
import { importer, type FileCandidate, type DirectoryCandidate, ImportResult } from 'ipfs-unixfs-importer'
import { MemoryBlockstore } from 'blockstore-core';
import { CID } from 'multiformats';
import stringify from 'json-stable-stringify-without-jsonify';

export type FsEntries = Array<FileCandidate | DirectoryCandidate>;

export async function getFileCID(file: FileCandidate) {
  const blockstore = new MemoryBlockstore();

  let rootEntry: ImportResult | undefined;
  for await (const entry of importer([file], blockstore)) {
    rootEntry = entry;
  }

  return rootEntry?.cid;
}

export function objectToFile(obj: Record<string, unknown>) {
  const encoder = new TextEncoder();
  const file = {
    content: encoder.encode(stringify(obj, { space: 2 }))
  };
  return file;
}

export async function createCARFile(entries: FsEntries): Promise<BlobPart[]> {
  const blockstore = new MemoryBlockstore();

  let rootEntry: ImportResult | undefined;
  for await (const entry of importer(entries, blockstore)) {
    rootEntry = entry;
  }

  if (rootEntry !== undefined) {
    const c = rootEntry.cid;
    const rootCID = new CID(
      c.version, c.code, c.multihash, c.bytes
    );
    console.log('root CID: ', rootCID.toString());

    const { writer, out } = CarWriter.create(rootCID);
    for await (const block of blockstore.getAll()) {
      writer.put({ 
        cid: new CID(block.cid.version, block.cid.code, block.cid.multihash, block.cid.bytes),
        bytes: block.block
      });
    }
    writer.close()

    const carParts = new Array<Uint8Array>();
    for await (const chunk of out) {
      carParts.push(chunk)
    }

    return carParts;
    // return new Blob(carParts, {
    //   type: 'application/car',
    // });
  } else {
    throw new Error('Unable to determine import into unixfs');
  }
}