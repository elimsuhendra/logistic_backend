import express from 'express'
import { excelRoute } from './excel'
import { fileRoute } from './rawFiles'

export const routes = (app, context) => {
  const { router } = context || {}
  router.use(express.json({ strict: false }))
  router.use(
    express.urlencoded({
      extended: false
    })
  )

  excelRoute(app, context)
  fileRoute(app, context)
  
  app.use('/', router)
}
