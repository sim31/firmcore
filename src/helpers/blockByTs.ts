import { ethers } from 'ethers';

export async function getBlockNumberByTimestamp(
    provider: ethers.providers.JsonRpcProvider,
    timestamp: number
): Promise<number> {
    const getBlockTime = async (blockNumber: number) => (await provider.getBlock(blockNumber)).timestamp;
    
    let leftBlockNumber = 0;
    let leftTimestamp = await getBlockTime(leftBlockNumber);
    let rightBlockNumber = await provider.getBlockNumber();
    let rightTimestamp = await getBlockTime(rightBlockNumber);
    
    if (timestamp <= leftTimestamp) {
        return leftBlockNumber;
    }
    
    if (timestamp >= rightTimestamp) {
        return rightBlockNumber;
    }
    
    // eslint-disable-next-line no-constant-condition
    while (true) {
        const middleBlockNumber = leftBlockNumber + Math.floor((rightBlockNumber - leftBlockNumber) / 2);
        const middleTimestamp = await getBlockTime(middleBlockNumber);
        if (timestamp === middleTimestamp) {
            return middleBlockNumber;
        } else if (timestamp < middleTimestamp) {
            rightBlockNumber = middleBlockNumber;
            rightTimestamp = middleTimestamp;
        } else {
            leftBlockNumber = middleBlockNumber;
            leftTimestamp = middleTimestamp;
        }

        if (rightBlockNumber - leftBlockNumber <= 1) {
            return leftBlockNumber;
        }
    }
}