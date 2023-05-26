import { AddressStr } from 'firmcontracts/interface/types';
import { Overwrite } from 'utility-types';
import * as t from 'io-ts';

const WithGasLimitCodec = t.partial({
  gasLimit: t.number
});

export const CInputEncCodec = t.intersection([
  WithGasLimitCodec,
  t.type({
    to: t.string,
    data: t.string,
  })
]);
export type CInputEncoded = t.TypeOf<typeof CInputEncCodec>;

export const CInputDecCodec = t.intersection([
  WithGasLimitCodec,
  t.type({
    to: t.string,
    data: t.UnknownRecord,
  })
]);
export type CInput = t.TypeOf<typeof CInputDecCodec>;

export const CInputTxCodec = t.type({
  transaction: t.string
})
export type CInputTx = t.TypeOf<typeof CInputTxCodec>;
