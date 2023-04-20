import { AccountWithAddress, Address, Confirmer, ConfirmerMap, ConfirmerOp, ConfirmerSet } from "../ifirmcore";

export function sumWeight(confs: { address: Address, weight?: number }[]): number {
  let sum = 0;
  for (const conf of confs) {
    if (conf.weight) {
      sum += conf.weight;
    } else {
      sum += 1;
    }
  }
  return sum;
}

export function defaultThreshold(confs: AccountWithAddress[]): number;
export function defaultThreshold(confs: Confirmer[]): number;
export function defaultThreshold(confs: Confirmer[] | AccountWithAddress[]): number {
  const sum = sumWeight(confs);
  const threshold = Math.ceil((sum * 2) / 3) + 1;
  return threshold;
}

export function updatedConfirmerMap(
  confMap: ConfirmerMap,
  confirmerOps: ConfirmerOp[]
): ConfirmerMap {
  const newMap = { ...confMap };
  for (const op of confirmerOps) {
    if (op.opId === 'add') {
      newMap[op.confirmer.address] = op.confirmer;
    } else if (op.opId === 'remove') {
      delete newMap[op.confirmer.address];
    }
  }
  return newMap;
}

export function updatedConfirmerSet(
  confirmerSet: ConfirmerSet,
  confirmerOps: ConfirmerOp[],
): ConfirmerSet {
  const updatedMap = updatedConfirmerMap(confirmerSet.confirmers, confirmerOps);
  return {
    confirmers: updatedMap,
    threshold: defaultThreshold(Object.values(updatedMap)),
  }
}
