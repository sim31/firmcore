import { AddressStr } from 'firmcontracts/interface/types.js';
import { Overwrite } from 'utility-types';
import * as t from 'io-ts';

const WithGasLimitCodec = t.partial({
  gasLimit: t.number
});

const WithMemoCodec = t.partial({
  memo: t.string
});

export const CInputEncCodec = t.intersection([
  WithGasLimitCodec,
  WithMemoCodec,
  t.type({
    to: t.string,
    data: t.string,
  })
]);
export type CInputEncoded = t.TypeOf<typeof CInputEncCodec>;

export const CInputDecCodec = t.intersection([
  WithGasLimitCodec,
  WithMemoCodec,
  t.type({
    to: t.string,
    data: t.UnknownRecord,
  })
]);
export type CInputDec = t.TypeOf<typeof CInputDecCodec>;

export const FunctionArgCodec = t.type({
  name: t.string,
  value: t.unknown,
});
export type FunctionArg = t.TypeOf<typeof FunctionArgCodec>;

export const FactoryInputDecCodec = t.intersection([
  WithGasLimitCodec,
  WithMemoCodec,
  t.type({
    to: t.string,
    constructorArgs: t.array(FunctionArgCodec),
    bytecode: t.string,
    abiCIDStr: t.string,
  })
]);
export type FactorInputDec = t.TypeOf<typeof FactoryInputDecCodec>;

export const CInputTxCodec = t.intersection([
  WithMemoCodec,
  t.type({
    transaction: t.string
  })
]);
export type CInputTx = t.TypeOf<typeof CInputTxCodec>;
