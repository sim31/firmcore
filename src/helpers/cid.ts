import { CID } from "multiformats/cid";
import { InvalidArgument } from "../exceptions/InvalidArgument.js";
import { CIDStr } from "../ifirmcore/index.js";

export function isValidCid0(value: string): boolean {
  if (value.length === 46 && value.slice(0, 2) === 'Qm') {
    return true;
  } else {
    return false;
  }
}

export function urlToCid0(value: string): string {
  if (value.slice(0, 7) === 'ipfs://') {
    return value.slice(7);
  } else {
    throw new InvalidArgument('not ipfs url');
  }
}

export function toCIDStr(cid: CID): CIDStr {
  return cid.toV0().toString();
}
