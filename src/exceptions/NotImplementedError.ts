import { OpNotSupprtedError } from "./OpNotSupported.js";

export class NotImplementedError extends OpNotSupprtedError {
  constructor(msg?: string) {
    super('Not implemented' + msg ? ` ${msg}` : '.');
  }
}