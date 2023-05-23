import OpNotSupprtedError from "./OpNotSupported";

export default class NotImplementedError extends OpNotSupprtedError {
  constructor(msg?: string) {
    super('Not implemented' + ` ${msg}.` ?? '.')
  }
}