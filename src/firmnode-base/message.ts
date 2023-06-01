import { AddressStr } from "firmcontracts/interface/types.js"
import { CInputEncoded, CInputDecCodec, CInputEncCodec, CInputTxCodec, FactoryInputDecCodec, FunctionArg } from "./contractInput.js"
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
  t.type({ type: t.literal('ContractInputDec') })
]);
export type CInputDecMsg = t.TypeOf<typeof CInputDecMsgCodec>;

export const CInputEncMsgCodec = t.intersection([
  MessageCodec,
  CInputEncCodec,
  t.type({ type: t.literal('ContractInputEnc') })
])
export type CInputEncMsg = t.TypeOf<typeof CInputEncMsgCodec>;
export function newCInputEncMsg(to: string, data: string, gasLimit?: number): CInputEncMsg {
  return { type: 'ContractInputEnc', to, data, gasLimit };
}

export const CInputTxMsgCodec = t.intersection([
  MessageCodec,
  CInputTxCodec,
  t.type({ type: t.literal('ContractInputTx') })
]);
export type CInputTxMsg = t.TypeOf<typeof CInputTxMsgCodec>;
export function newCInputTxMsg(to: string, transaction: string): CInputTxMsg {
  return { type: 'ContractInputTx', to, transaction };
}

export const FactoryInputDecMsgCodec = t.intersection([
  MessageCodec,
  FactoryInputDecCodec,
  t.type({ type: t.literal('FactoryInputDec')})
])
export type FactoryInputDecMsg = t.TypeOf<typeof FactoryInputDecMsgCodec>;
export function newFactoryInputDecMsg(
  to: string, constructorArgs: FunctionArg[], bytecode: string, abiCIDStr: string,
  memo?: string, gasLimit?: number
): FactoryInputDecMsg {
  return {
    type: 'FactoryInputDec',
    to, constructorArgs,
    bytecode, abiCIDStr,
    memo, gasLimit
  }
}

// Messages which are meant as inputs to smart contracts
export const CInputMsgCodec = t.union([
  CInputDecMsgCodec,
  CInputEncMsgCodec,
  CInputTxMsgCodec,
  FactoryInputDecMsgCodec
]);
export type ContractMsg = t.TypeOf<typeof CInputMsgCodec>;
