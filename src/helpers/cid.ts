import InvalidArgument from "../exceptions/InvalidArgument";

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