# Clothes application

React frontend, Node.js/Express API, and Supabase starter workspace.

## First-time setup

1. Copy `frontend/.env.example` to `frontend/.env`.
2. Copy `backend/.env.example` to `backend/.env`.
3. Add the credentials from **Supabase Dashboard → Project Settings → API**.
4. Keep the service-role key server-side only. Never add it to the client environment.

## Commands

This repository includes a project-local Node.js runtime under `.tools` because Node was not installed on this computer.

```powershell
$env:Path = "$PWD\.tools\node-v24.20.0-win-x64;$env:Path"
npm.cmd run dev
```

Open <http://localhost:5173>. The API runs at <http://localhost:3001>.

Other commands:

```powershell
npm.cmd run build
npm.cmd run lint
npm.cmd start
```

## Git

Git for Windows is available locally in `.tools`. Use the included wrapper:

```powershell
.\git.cmd status
.\git.cmd add .
.\git.cmd commit -m "Initial project setup"
.\git.cmd push -u origin main
```
