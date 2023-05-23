import { CarWriter } from '@ipld/car/writer'
import { importer, type FileCandidate, type DirectoryCandidate, ImportResult } from 'ipfs-unixfs-importer'
import { MemoryBlockstore } from 'blockstore-core';

export type FsEntries = Array<FileCandidate | DirectoryCandidate>;

export async function createCARFile(entries: FsEntries): Promise<Blob> {
  const blockstore = new MemoryBlockstore();

  let rootEntry: ImportResult | undefined;
  for await (const entry of importer(entries, blockstore)) {
    rootEntry = entry;
  }

  if (rootEntry !== undefined) {
    const rootCID = rootEntry.cid;
    console.log('root CID: ', rootCID.toString());

    const { writer, out } = CarWriter.create(rootCID);
    for await (const block of blockstore.getAll()) {
      await writer.put({ ...block, bytes: block.block });
    }
    await writer.close()

    const carParts = new Array<Uint8Array>();
    for await (const chunk of out) {
      carParts.push(chunk)
    }
    return new Blob(carParts, {
      type: 'application/car',
    });
  } else {
    throw new Error('Unable to determine import into unixfs');
  }
}