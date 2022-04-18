import BigNumber from 'bignumber.js'
import { calculateFeeToLiquidator } from './src/utils/calculator'
import { getLiquidationFeeAndPenaltyRatio, getPartialLiquidationRatio } from './src/utils/position/positionConfiguration'
import { getManualMargin, getRawPosition } from './src/utils/position/positionHouse'
import { getMaintenanceDetail, getPositionNotionalAndUnrealizedPnl } from './src/utils/position/positionViewer'
import { getBalanceNumber } from './src/utils/number'
import getSender from './src/utils/getSender'
import liquidate from './src/utils/position/signed/liquidate'
import getMarketLabel from './src/utils/getMarketLabel'
import configs from './config'

const checkValidPosition = (rawPosition: any): boolean => {
  const ZERO = new BigNumber(0)

  const quantity = new BigNumber(rawPosition[0])
  const margin =  new BigNumber(rawPosition[1])
  const openNotional = new BigNumber(rawPosition[2])
  const lastUpdatedCumulativePremiumFraction =  new BigNumber(rawPosition[3])
  const blockNumber = new BigNumber(rawPosition[4])
  const leverage = new BigNumber(rawPosition[5])

  return (
    quantity.isEqualTo(ZERO)
      && margin.isEqualTo(ZERO)
      && openNotional.isEqualTo(ZERO)
      && lastUpdatedCumulativePremiumFraction.isEqualTo(ZERO)
      && blockNumber.isEqualTo(ZERO)
      && leverage.isEqualTo(ZERO)
        ? false
        : true
  )
}

const canLiquidate = (
  marginRatio: BigNumber,
  partialLiquidationRatio: BigNumber
): boolean => {
  return marginRatio.gte(partialLiquidationRatio)
}

const isEnoughProfit = (
  currentProfit: BigNumber,
  minimumProfit = configs.bot.MINIMUM_PROFIT_BUSD
): boolean => {
  return currentProfit.gte(new BigNumber(minimumProfit).times(1e18))
}

export const checkAndLiquidate = async (pmAddress: string, trader: string) => {
  const rawPosition = await getRawPosition(pmAddress, trader)
  const isValidPosition = checkValidPosition(rawPosition)

  if (!isValidPosition) {
    return
  }

  const { unrealizedPnl } = await getPositionNotionalAndUnrealizedPnl(
    pmAddress,
    trader,
    rawPosition
  )
  const { marginRatio } = await getMaintenanceDetail(pmAddress, trader)
  const partialLiquidationRatio = await getPartialLiquidationRatio()
  const isCanLiquidate = canLiquidate(marginRatio, partialLiquidationRatio)
  console.log(`${getMarketLabel(pmAddress)} \t ${trader} \t ${getBalanceNumber(rawPosition[0])} \t\t ${rawPosition[5]} \t\t ${getBalanceNumber(unrealizedPnl)} \t\t ${marginRatio.toString()} \t\t ${isCanLiquidate}`)

  if (isCanLiquidate) {
    const { liquidationFeeRatio } = await getLiquidationFeeAndPenaltyRatio()
    const positionMargin = new BigNumber(rawPosition[1])
    const manualMargin = await getManualMargin(pmAddress, trader)
    
    const profit = calculateFeeToLiquidator(
      marginRatio,
      partialLiquidationRatio,
      liquidationFeeRatio,
      positionMargin,
      manualMargin
    )

    console.log(`🔥 Liquidate Order ${pmAddress}:${trader}, profit = ${getBalanceNumber(profit)}`)

    if (isEnoughProfit(profit) && configs.bot.ENABLE) {
      console.log(`🔥 Liquidating ${pmAddress}:${trader} with $${getBalanceNumber(profit)} profit.....`)
      const sender = getSender(configs.sender.PRIVATE_KEY)
      await liquidate(sender, pmAddress, trader)
    }
  }
}
