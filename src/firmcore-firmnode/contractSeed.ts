import { IPFSLink } from 'firmcontracts/interface/types'
import { ContractInput, ContractTxInput } from './contractInput'

export interface ContractSeed {
  // TODO: better type
  abiCID?: IPFSLink
  deploymentTx: ContractInput | ContractTxInput
}