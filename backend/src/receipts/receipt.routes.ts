import { Router } from 'express'
import { createRequireAuth,createRequireTenant,requireRole } from '../auth/auth.middleware.js'
import type { AuthDependencies } from '../auth/auth.types.js'
import { UserRole } from '../generated/prisma/enums.js'
import { HttpError } from '../errors/http-error.js'
import { parseCatalogId } from '../products/product.schemas.js'
import { parseIdempotencyKey } from '../restocks/restock.schemas.js'
import { object,parseReceipt,parseReceivingSetup } from './receipt.schemas.js'
import type { ReceiptDependencies } from './receipt.service.js'

export function createReceiptRouter(auth:AuthDependencies,receipts:ReceiptDependencies) {
  const router=Router()
  router.use(['/receipts','/product-setups'],createRequireAuth(auth),createRequireTenant(auth))
  router.post('/receipts',requireRole(UserRole.OWNER),async(req,res,next)=>{
    try {
      const input=object(req.body,['productId','unitCost','items'])
      const result=await receipts.receiveExisting(req.auth!.accountId!,req.auth!.userId,parseCatalogId(input.productId,'productId'),parseIdempotencyKey(req.headers,req.rawHeaders),parseReceipt({unitCost:input.unitCost,items:input.items}))
      res.status(result.idempotentReplay?200:201).json(result)
    }catch(error){next(error)}
  })
  router.post('/product-setups',async(req,res,next)=>{
    try {
      const result=await receipts.createSetup(req.auth!.accountId!,req.auth!.userId,req.auth!.role,parseIdempotencyKey(req.headers,req.rawHeaders),parseReceivingSetup(req.body,req.auth!.role===UserRole.OWNER))
      res.status(result.idempotentReplay?200:201).json(result)
    }catch(error){next(error)}
  })
  router.get('/receipts',async(req,res,next)=>{
    try {
      if(Object.keys(req.query).some(key=>key!=='page') || (req.query.page!==undefined && (typeof req.query.page!=='string'||! /^[1-9]\d{0,3}$/.test(req.query.page)))) throw new HttpError(422,'INVALID_RECEIPT_FILTER','Invalid receipt page')
      res.json(await receipts.history(req.auth!.accountId!,req.auth!.role===UserRole.OWNER,Number(req.query.page??1)))
    }catch(error){next(error)}
  })
  router.get('/receipts/by-operation/:key',requireRole(UserRole.OWNER),async(req,res,next)=>{
    try{res.json(await receipts.recover(req.auth!.accountId!,req.auth!.userId,parseCatalogId(req.params.key,'operationId')))}catch(error){next(error)}
  })
  return router
}
