import type { Router } from 'express'
import { createExchange } from './exchange.controller.js'
import type { ExchangeDependencies } from './exchange.types.js'

export function registerExchangeRoutes(router: Router, exchanges: ExchangeDependencies): void {
  router.post('/:saleId/exchanges', createExchange(exchanges))
}
