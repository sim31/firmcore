import { IPFSLink } from 'firmcontracts/interface/types'
import { CInputEncMsg, CInputDecMsg, CInputTxMsg } from './message'

export interface ContractSeed {
  // TODO: better type
  abiCID?: IPFSLink
  deploymentMsg: CInputEncMsg | CInputTxMsg | CInputDecMsg
}