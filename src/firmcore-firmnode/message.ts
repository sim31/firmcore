import { AddressStr } from "firmcontracts/interface/types"
import { CInput, CInputEncoded, CInputDecCodec, CInputEncCodec, CInputTxCodec } from "./contractInput"
import * as t from 'io-ts';

export const TypedCodec = t.partial({
  type: t.string
});

export const AddressedCodec = t.type({
  to: t.string
});

export const MessageCodec = t.intersection([TypedCodec, AddressedCodec]);
export type Message = t.TypeOf<typeof MessageCodec>;

export const CInputDecMsgCodec = t.intersection([
  MessageCodec, 
  CInputDecCodec,
  t.type({ type: t.literal('ContractInput') })
]);
export type CInputMsg = t.TypeOf<typeof CInputDecMsgCodec>;

export const CInputEncMsgCodec = t.intersection([
  MessageCodec,
  CInputEncCodec,
  t.type({ type: t.literal('ContractInputEncoded') })
])
export type CInputEncMsg = t.TypeOf<typeof CInputEncMsgCodec>;

export const CInputTxMsgCodec = t.intersection([
  MessageCodec,
  CInputTxCodec,
  t.type({ type: t.literal('ContractTxMsg') })
]);
export type CInputTxMsg = t.TypeOf<typeof CInputTxMsgCodec>;

// Messages which are meant as inputs to smart contracts
export const CInputMsgCodec = t.union([
  CInputDecMsgCodec,
  CInputEncMsgCodec,
  CInputTxMsgCodec
]);
export type ContractMsg = t.TypeOf<typeof CInputMsgCodec>;