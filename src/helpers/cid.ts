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

export function isIPFSUrl(value: string): boolean {
  return value.slice(0, 7) === 'ipfs://';
}

export function parseIPFSId(value: string): CIDStr {
  let cidStr: string;
  if (isIPFSUrl(value)) {
    cidStr = urlToCid0(value);
  } else {
    cidStr = value;
  }
  const r = CID.parse(cidStr);
  return r.toV0().toString();
}

export function toCIDStr(cid: CID): CIDStr {
  return cid.toV0().toString();
}
