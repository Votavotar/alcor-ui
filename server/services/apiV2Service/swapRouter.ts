import { Router } from 'express'
import { SwapPool, SwapChartPoint, Position } from '../../models'

import { tryParseCurrencyAmount } from '../../../utils/amm'
import { getAllTokensWithPrices } from '../updaterService/prices'

import { CurrencyAmount } from '../../../assets/libs/swap-sdk/entities/fractions/currencyAmount'
import { Pool } from '../../../assets/libs/swap-sdk/entities/pool'
import { Token } from '../../../assets/libs/swap-sdk/entities/token'
import { Trade } from '../../../assets/libs/swap-sdk/entities/trade'
import { Percent } from '../../../assets/libs/swap-sdk/entities/fractions/percent'

import { getRedisTicks, getPools } from '../swapV2Service/utils'

export const swapRouter = Router()

const TRADE_OPTIONS = { maxNumResults: 1, maxHops: 6 }


// const [trade] = exactIn
//   ? await this.bestTradeExactIn({ currencyAmountIn, currencyOut: tokenB })
//   : await this.bestTradeExactOut({ currencyIn: tokenA, currencyAmountOut })


swapRouter.get('/getRoute', async (req, res) => {
  const network: Network = req.app.get('network')

  let { trade_type, input, output, amount, slippage, receiver = '<receiver>' } = <any>req.query

  if (!trade_type || !input || !output || !amount)
    return res.status(403).send('Invalid request')

  if (!slippage) slippage = 0.3
  slippage = new Percent(slippage * 100, 10000)

  const exactIn = trade_type == 'EXACT_INPUT'

  const pools = await getPools(network.name)

  input = pools.find(p => p.tokenA.id == input)?.tokenA || pools.find(p => p.tokenB.id == input)?.tokenB
  output = pools.find(p => p.tokenA.id == output)?.tokenA || pools.find(p => p.tokenB.id == output)?.tokenB

  if (!input || !output) res.status(403).send('Invalid input/output')

  amount = tryParseCurrencyAmount(amount, exactIn ? input : output)
  if (!amount) res.status(403).send('Invalid amount')

  //console.log('amount', amount)

  let trade
  if (exactIn) {
    [trade] = await Trade.bestTradeExactIn(
      pools.filter(p => p.tickDataProvider.ticks.length > 0),
      amount,
      output,
      TRADE_OPTIONS
    )
  } else {
    [trade] = await Trade.bestTradeExactOut(
      pools.filter(p => p.tickDataProvider.ticks.length > 0),
      input,
      amount,
      TRADE_OPTIONS
    )
  }

  const method = exactIn ? 'swapexactin' : 'swapexactout'
  const route = trade.route.pools.map(p => p.id)

  const maxSent = exactIn ? trade.inputAmount : trade.maximumAmountIn(slippage)
  const minReceived = exactIn ? trade.minimumAmountOut(slippage) : trade.outputAmount

  // Memo Format <Service Name>#<Pool ID's>#<Recipient>#<Output Token>#<Deadline>
  const memo = `${method}#${route.join(',')}#${receiver}#${minReceived.toExtendedAsset()}#0`

  const result = {
    input: trade.inputAmount.toFixed(),
    output: trade.outputAmount.toFixed(),
    minReceived: minReceived.toFixed(),
    maxSent: maxSent.toFixed(),
    priceImpact: trade.priceImpact.toSignificant(),
    memo,
    route,
    executionPrice: {
      numerator: trade.executionPrice.numerator.toString(),
      denominator: trade.executionPrice.denominator.toString()
    }
  }

  res.json(result)
})