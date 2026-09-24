import { Router } from 'express'
import { createRequireAuth, createRequireTenant, requireRole } from '../auth/auth.middleware.js'
import type { AuthDependencies } from '../auth/auth.types.js'
import { UserRole } from '../generated/prisma/enums.js'
import { getDailyReport, getSummaryReport } from './report.controller.js'
import type { ReportDependencies } from './report.types.js'

export function createReportRouter(auth: AuthDependencies, reports: ReportDependencies): Router {
  const router = Router()
  router.use(createRequireAuth(auth), createRequireTenant(auth), requireRole(UserRole.OWNER))
  router.get('/daily', getDailyReport(reports))
  router.get('/summary', getSummaryReport(reports))
  return router
}
