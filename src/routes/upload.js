import express from 'express'
import fs from 'fs'
import path from 'path'
import appRoot from 'app-root-path'

export const uploadRoute = (app, { router }) => {
  const uploadDir = path.join(appRoot.path, 'public', 'upload')
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true })
  }

  // Handle direct file upload via raw binary stream
  router.post('/upload', express.raw({ type: '*/*', limit: '20mb' }), async (req, res) => {
    try {
      if (!req.body || (Buffer.isBuffer(req.body) && req.body.length === 0)) {
        return res.status(400).json({ success: false, message: 'No file data received' })
      }

      const mimeType = (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase()
      const extFromMime = {
        'image/jpeg': '.jpg',
        'image/jpg': '.jpg',
        'image/png': '.png',
        'image/gif': '.gif',
        'image/webp': '.webp',
        'image/svg+xml': '.svg',
      }[mimeType] || ''

      const rawFilename = req.headers['x-filename'] || req.query.filename || `photo-${Date.now()}`
      let cleanName = path.basename(rawFilename).replace(/[^a-zA-Z0-9._-]/g, '_')
      
      if (!path.extname(cleanName) && extFromMime) {
        cleanName += extFromMime
      }

      // Ensure unique filename if already exists
      let targetPath = path.join(uploadDir, cleanName)
      if (fs.existsSync(targetPath)) {
        const ext = path.extname(cleanName)
        const nameWithoutExt = path.basename(cleanName, ext)
        cleanName = `${nameWithoutExt}-${Date.now()}${ext}`
        targetPath = path.join(uploadDir, cleanName)
      }

      fs.writeFileSync(targetPath, req.body)

      const serverUrl = `${req.protocol}://${req.get('host')}`
      const fileUrl = `${serverUrl}/public/upload/${cleanName}`

      return res.status(200).json({
        success: true,
        url: fileUrl,
        filename: cleanName
      })
    } catch (err) {
      console.error('Upload error:', err)
      return res.status(500).json({ success: false, message: err.message })
    }
  })
}

