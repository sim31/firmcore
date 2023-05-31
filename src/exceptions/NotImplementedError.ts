import { OpNotSupprtedError } from "./OpNotSupported.js";

export class NotImplementedError extends OpNotSupprtedError {
  constructor(msg?: string) {
    if (msg) {
      super(`Not implemented. ${msg}`)
    } else {
      super('Not implemented');
    }
  }
}