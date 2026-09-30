# StreamBird web app

React + Vite SPA for the StreamBird dashboard. Talks to the NestJS API
under `/api/*` (same-origin in production; proxied in dev, see
`vite.config.ts`).

```
npm install
npm run dev     # dev server on :5173, proxies /api -> localhost:3000
npm run build   # outputs to ../dist-web, served by the Nest app
```

Requires the backend (`../`) running separately for `npm run dev` to have
anything to talk to.
