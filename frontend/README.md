# Lutealark frontend

React 19 + TypeScript + Vite + Tailwind CSS client for the Lutealark agent.

## Development

Start the backend from the repository root first. Then run:

```powershell
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`. Vite proxies `/api` to
`http://localhost:3000`, so no OpenTrek credentials are stored in the browser.

For a deployed frontend, copy `.env.example` to `.env` and set
`VITE_API_BASE_URL` to the public backend origin.
