
export function arrayToRecord<
  T extends { [K in keyof T]: string | number | symbol }, // added constraint
  K extends keyof T
>(array: T[], selector: K): Record<T[K], T> {
  return array.reduce((acc, item) => (acc[item[selector]] = item, acc), {} as Record<T[K], T>)
}