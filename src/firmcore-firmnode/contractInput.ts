import { AddressStr } from 'firmcontracts/interface/types';
import { Overwrite } from 'utility-types';
import * as t from 'io-ts';

export const CInputEncCodec = t.type({
  to: t.string,
  gasLimit: t.number,
  data: t.string,
});
export type CInputEncoded = t.TypeOf<typeof CInputEncCodec>;

export const CInputDecCodec = t.type({
  to: t.string,
  gasLimit: t.number,
  data: t.UnknownRecord,
});
export type CInput = t.TypeOf<typeof CInputDecCodec>;

export const CInputTxCodec = t.type({
  transaction: t.string
})
export type CInputTx = t.TypeOf<typeof CInputTxCodec>;
