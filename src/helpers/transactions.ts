import { ethers } from "ethers";

export function txApplied(receipt: ethers.providers.TransactionReceipt): boolean {
  return receipt.status === 1;
}