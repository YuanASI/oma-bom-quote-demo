import { existsSync } from 'node:fs'
import express from 'express'
import { createDemoApp } from './app.js'
import { projectPath } from './fixture-loader.js'

const demoBasePath = '/demos/bom-quote-review'
const dev = process.argv.includes('--dev')
const port = Number(process.env['PORT'] || process.env['OMA_PORT'] || 5173)
const host = process.env['HOST']?.trim() || process.env['OMA_HOST']?.trim() || '127.0.0.1'
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error('PORT / OMA_PORT 必须是有效端口号')
}

const app = createDemoApp()

if (dev) {
  const { createServer } = await import('vite')
  const vite = await createServer({
    root: projectPath(),
    appType: 'spa',
    server: { middlewareMode: true },
  })
  app.use(vite.middlewares)
} else {
  const dist = projectPath('dist')
  if (!existsSync(dist)) {
    throw new Error('缺少 dist；请先运行 npm run build')
  }
  app.get('/', (_req, res) => {
    res.redirect(302, `${demoBasePath}/`)
  })
  app.use(demoBasePath, express.static(dist, {
    immutable: true,
    maxAge: '1y',
    index: false,
  }))
  app.use((req, res, next) => {
    if (
      req.method !== 'GET' ||
      !req.accepts('html') ||
      (req.path !== demoBasePath && !req.path.startsWith(`${demoBasePath}/`))
    ) {
      next()
      return
    }
    res.sendFile(projectPath('dist', 'index.html'))
  })
}

app.listen(port, host, () => {
  const mode = dev ? 'development' : 'production'
  console.log(`OMA BOM Demo (${mode}) listening on ${host}:${port}${demoBasePath}/`)
})
