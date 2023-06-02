import { NotInitialized } from "../exceptions/NotInitialized.js";
import { OpNotSupprtedError } from "../exceptions/OpNotSupported.js";
import { FilesTagger, Tag } from "../files-tagger/index.js";
import { IConstructor } from "../helpers/iconstructor.js";
import { IFirmCore } from "../ifirmcore/index.js";

export class FirmcoreManager<T extends IFirmCore> {
  private _tagger: FilesTagger;
  private _fcClass: IConstructor<T>;
  private _current: T | undefined;

  constructor(tagger: FilesTagger, firmcoreClass: IConstructor<T>) {
    this._tagger = tagger;
    this._fcClass= firmcoreClass;
  }

  async get(): Promise<IFirmCore> {
    if (this._current !== undefined) {
      return this._current;
    }

    this._current = new this._fcClass();

    const tags = await this._tagger.ls();
    const first = tags[0];
    if (first === undefined) {
      await this._current.init();
    } else {
      const car = await this._tagger.getTaggedAsCAR(first);
      await this._current.init(car);
    }

    return this._current;
  }

  async tag(tagName: string): Promise<void> {
    // Does not make sense to tag anything before retrieving it
    if (this._current === undefined) {
      throw new NotInitialized('FirmcoreManager not initialized');
    }

    const car = await this._current.exportAsCAR();
    await this._tagger.setTag(tagName, car);
  }

  async lsTags(): Promise<Tag[]> {
    return await this._tagger.ls();
  }
  // TODO: selectTagged

}