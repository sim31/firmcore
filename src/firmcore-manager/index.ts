import { NotInitialized } from "../exceptions/NotInitialized.js";
import { OpNotSupprtedError } from "../exceptions/OpNotSupported.js";
import { FilesTagger, Tag, TagsByName } from "../files-tagger/index.js";
import { toCIDStr } from "../helpers/cid.js";
import { IConstructor } from "../helpers/iconstructor.js";
import { CIDStr, IFirmCore } from "../ifirmcore/index.js";

export class FirmcoreManager<T extends IFirmCore> {
  private _tagger: FilesTagger;
  private _fcClass: IConstructor<T>;
  private _current: T | undefined;
  private _currentTag: Tag | undefined;
  private _cachedTags: TagsByName = {};

  constructor(tagger: FilesTagger, firmcoreClass: IConstructor<T>) {
    this._tagger = tagger;
    this._fcClass= firmcoreClass;
  }

  private async _retrieveTags(): Promise<TagsByName> {
    this._cachedTags = await this._tagger.lsByName();
    return this._cachedTags;
  }

  async get(): Promise<IFirmCore> {
    if (this._current !== undefined) {
      return this._current;
    }

    if (!this._tagger.isInitialized()) {
      await this._tagger.init();
    }

    this._current = new this._fcClass();

    const tags = await this._retrieveTags();

    this._currentTag = Object.values(tags)[0];
    if (this._currentTag === undefined) {
      await this._current.init();
    } else {
      const car = await this._tagger.getTaggedAsCAR(this._currentTag);
      await this._current.init(car);
    }

    return this._current;
  }

  async new(): Promise<IFirmCore> {
    delete this._current;
    delete this._currentTag;

    this._current = new this._fcClass();
    await this._current.init();

    return this._current;
  }

  async selectByCID(cid: CIDStr): Promise<IFirmCore> {
    delete this._current;
    delete this._currentTag;

    const car = await this._tagger.getCAR(cid);

    this._current = new this._fcClass();
    await this._current.init(car);

    return this._current;
  }

  private _updateCache(tag: Tag) {
    this._cachedTags[tag.name] = tag;
  }

  async tag(tagName: string): Promise<void> {
    // Does not make sense to tag anything before retrieving it
    if (this._current === undefined) {
      throw new NotInitialized('FirmcoreManager not initialized');
    }

    const car = await this._current.exportAsCAR();
    await this._tagger.setTag(tagName, car);

    this._currentTag = await this._tagger.getTag(tagName);

    this._updateCache({ name: tagName, cidStr: toCIDStr(car.rootCID) })
  }

  getCurrentTag(): Tag | undefined {
    return this._currentTag;
  }

  async lsTags(): Promise<Tag[]> {
    return await this._tagger.ls();
  }

  async getTagsByName(cached?: boolean): Promise<TagsByName> {
    if (cached) {
      return this._cachedTags;
    } else {
      return await this._tagger.lsByName();
    }
  }

}