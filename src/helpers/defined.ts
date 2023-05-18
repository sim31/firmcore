
export function isDefined(values: Array<any | undefined>) {
  for (const val of values) {
    if (val === undefined) {
      return false;
    }
  }

  return true;
}