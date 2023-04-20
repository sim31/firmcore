import ProgrammingError from "../exceptions/ProgrammingError";

export default function assert(condition: any, msg: string) {
  if (!condition) {
    throw new ProgrammingError(msg);
  }
}