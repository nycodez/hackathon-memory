import app from './app.js'

const port = Number(process.env.PORT ?? 3333)
const host = process.env.HOST ?? '0.0.0.0'

app.listen(port, host, () => {
  console.log(`Hackathon Memory API listening at http://${host}:${port}`)
})
