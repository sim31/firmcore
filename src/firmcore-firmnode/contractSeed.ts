import { IPFSLink } from 'firmcontracts/interface/types.js'
import { CInputEncMsg, CInputDecMsg, CInputTxMsg } from './message.js'

export interface ContractSeed {
  // TODO: better type
  abiCID?: IPFSLink
  deploymentMsg: CInputEncMsg | CInputTxMsg | CInputDecMsg
}