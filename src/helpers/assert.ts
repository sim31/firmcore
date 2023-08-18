import { ProgrammingError } from "../exceptions/ProgrammingError.js";

export default function assert(condition: any, msg: string = '') {
  if (!condition) {
    throw new ProgrammingError(msg);
  }
}

export function assertDefined<T>(obj: T | undefined, msg: string = ''): T {
  assert(obj !== undefined, msg);
  return obj!;
}
