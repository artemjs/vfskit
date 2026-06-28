# cloud-ide example

Monaco editor in the browser driving a real-disk VFS on the server over a WebSocket bridge,
with per-user prefix isolation.

```
# from the repo root, build the facades first
npm run build

# then in this folder
cd examples/cloud-ide
npm install
npm start            # http://localhost:3000
```

The browser loads `vfskit-front` and `monaco-editor` from jsDelivr, opens
`remote(wsTransport(...))`, and reads/writes `/main.js`. The server runs
`serve(nodeFs(data/<user>))`.

Switch the backend to S3 by changing one line in `server.mjs`:

```js
serve(s3({ client, prefix: user }))   // instead of serve(nodeFs(join(DATA, user)))
```
