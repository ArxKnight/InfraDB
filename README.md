# InfraDB

![InfraDB Logo](frontend/public/infradb-logo.png)

InfraDB is a full-stack infrastructure tracking and labeling platform for multi-site environments.
It combines cable labeling, SID lifecycle management, location-aware inventory structure, admin tooling, and print/export utilities in one system.

- Frontend: React + TypeScript + Vite + Tailwind + shadcn/ui
- Backend: Express + TypeScript + MySQL
- Deployment: Local Node, Docker Compose, Unraid-compatible container workflows

---

## Features

### Core
- Multi-site management with per-user site memberships
- Structured locations (`DATACENTRE` and `DOMESTIC` templates)
- Location records support rack size (`Rack Size (U)`) and admin location tables display it
- DOCX cable report export

### Cable Platform
- Cable label lifecycle with per-site sequential references
- Cable type management per site
- Label create/edit form supports optional connected endpoints behind a toggle and validates endpoint fields only when enabled

### MAP Platform
- MAPIndex rack visualisations align racks from `U1` for mixed rack-size side-by-side comparison
- MAPIndex cable trace uses explicit actions (`Open Source SID`, `Open Destination SID`, optional patch panel SID buttons, and `Open Cable Ref#` deep-link)

### SID Platform
- SID Index with search by status/SID/location/hostname/model
- SID detail pages for hardware/software/networking/location
- SID notes, pinned notes, passwords, NICs, and IP addresses
- SID admin picklists (types/models/platforms/statuses/password types/NIC types/NIC speeds/VLANs)
- Soft-delete SID model (`status = Deleted`) with read-only enforcement
- Show/hide deleted SIDs in index (`show_deleted`)
- Field-level SID history with granular diffs (including NIC/IP/password/note changes)

### Admin + Security
- JWT auth with refresh flow
- Role- and site-scoped permissions
- User invitations + invite acceptance
- App settings and SMTP test endpoint
- Password hashing and validated API contracts (Zod)

### Tools
- `/tools` includes: SID, 30DAY, TEXT, RACKS, IN-RACK, PORTS, PDU, QR GEN

---

## Architecture

### Frontend (`frontend/`)
- React Router protected app
- Auth + memberships context
- TanStack Query
- Pages: sites, cable, SID index/detail/admin, stock, tools, profile, admin, setup

Key routes:
- `/sites`
- `/sites/:siteId`
- `/sites/:siteId/cable`
- `/sites/:siteId/sid`
- `/sites/:siteId/sid/new`
- `/sites/:siteId/sid/:sidId`
- `/sites/:siteId/sid/admin`
- `/sites/:siteId/stock`
- `/tools`
- `/admin`

### Backend (`backend/`)
API base: `/api`
- `/api/auth`
- `/api/users`
- `/api/admin`
- `/api/sites`
- `/api/labels`
- `/api/setup`

Runtime behavior:
- Setup-gated API in non-test mode
- MySQL migrations on startup after setup completion
- SID secret-key bootstrap after setup
- Static frontend served by backend in production

---

## Permissions Model

InfraDB uses **global roles** (system-wide) and **site roles** (per-site).

### Global roles

**Global Admin**
- Full system access
- Manage users/invitations/settings
- Create/update/delete sites
- Access global stats

**User**
- Access assigned sites
- Perform site-scoped work
- Admin panel actions are limited to scope where user is Site Admin

### Site roles

**Site Admin**
- Manage site-level configuration
- Manage locations/cable types/SID picklists
- Full SID and label operations in that site

**Site User**
- Operate within site data flows (labels/SID viewing and permitted operations)
- No site-admin configuration actions

### Permission Matrix (Global Roles)

| Capability                 | Global Admin | User           |
|----------------------------|--------------|----------------|
| Access admin panel         | ✅           | 🏢*           |
| Manage users & invitations | ✅           | 🏢*           |
| Create sites               | ✅           | ❌            |
| View sites                 | ✅ (all)     | ✅ (assigned) |
| App settings               | ✅           | ❌            |
| Global stats               | ✅           | ❌            |

### Permission Matrix (Site Roles)

| Capability           | Site Admin | Site User |
|----------------------|------------|-----------|
| Update site details  | ✅        | ❌        |
| Manage locations     | ✅        | ❌        |
| Manage cable types   | ✅        | ❌        |
| Manage SID picklists | ✅        | ❌        |
| Create/update labels | ✅        | ✅        |
| SID admin operations | ✅        | ❌        |

*🏢 = Available only in scoped contexts where the user has Site Admin rights.

---

## API Overview

This is a practical high-level map. For implementation details, see `backend/src/routes/`.

### Setup + health
- `GET /api/health`
- `GET /api/setup/status`
- `POST /api/setup/test-connection`
- `POST /api/setup/complete`

### Auth
- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `GET /api/auth/me`
- `PUT /api/auth/profile`
- `PUT /api/auth/password`
- `POST /api/auth/password-reset`
- `POST /api/auth/logout`

### Sites
- `GET /api/sites`
- `POST /api/sites`
- `GET /api/sites/:id`
- `PUT /api/sites/:id`
- `DELETE /api/sites/:id`

### Site locations
- `GET /api/sites/:id/locations`
- `POST /api/sites/:id/locations`
- `PUT /api/sites/:id/locations/:locationId`
- `GET /api/sites/:id/locations/:locationId/usage`
- `DELETE /api/sites/:id/locations/:locationId`
- `POST /api/sites/:id/locations/:locationId/reassign-and-delete`

### Site cable types + report
- `GET /api/sites/:id/cable-types`
- `POST /api/sites/:id/cable-types`
- `PUT /api/sites/:id/cable-types/:cableTypeId`
- `DELETE /api/sites/:id/cable-types/:cableTypeId`
- `GET /api/sites/:id/cable-report`

### SID core
- `GET /api/sites/:id/sids`
- `POST /api/sites/:id/sids`
- `GET /api/sites/:id/sids/:sidId`
- `PUT /api/sites/:id/sids/:sidId`
- `DELETE /api/sites/:id/sids/:sidId` (soft delete)
- `GET /api/sites/:id/sids/:sidId/history`

### SID notes/password/networking
- `POST /api/sites/:id/sids/:sidId/notes`
- `PATCH /api/sites/:id/sids/:sidId/notes/:noteId/pin`
- `GET /api/sites/:id/sids/:sidId/password`
- `GET /api/sites/:id/sids/:sidId/passwords`
- `POST /api/sites/:id/sids/:sidId/passwords`
- `PUT /api/sites/:id/sids/:sidId/password`
- `PUT /api/sites/:id/sids/:sidId/passwords/:passwordTypeId`
- `PUT /api/sites/:id/sids/:sidId/nics`
- `GET /api/sites/:id/sids/:sidId/ip-addresses`
- `PUT /api/sites/:id/sids/:sidId/ip-addresses`

### SID picklists (site-scoped)
- `/api/sites/:id/sid/types`
- `/api/sites/:id/sid/device-models`
- `/api/sites/:id/sid/cpu-models`
- `/api/sites/:id/sid/platforms`
- `/api/sites/:id/sid/statuses`
- `/api/sites/:id/sid/password-types`
- `/api/sites/:id/sid/nic-types`
- `/api/sites/:id/sid/nic-speeds`
- `/api/sites/:id/sid/vlans`

(Each supports list/create/update/delete and usage checks in current backend patterns.)

### Labels
- `GET /api/labels`
- `GET /api/labels/:id`
- `POST /api/labels`
- `PUT /api/labels/:id`
- `DELETE /api/labels/:id`
- `POST /api/labels/bulk-delete`
- `GET /api/labels/stats`
- `GET /api/labels/recent`
- `GET /api/labels/:id/zpl`
- `POST /api/labels/bulk-zpl`
- `POST /api/labels/bulk-zpl-range`
- `POST /api/labels/port-labels/zpl`
- `POST /api/labels/pdu-labels/zpl`

### Admin
- `GET /api/admin/overview`
- `POST /api/admin/invite`
- `GET /api/admin/invitations`
- `POST /api/admin/invitations/:id/link`
- `POST /api/admin/invitations/:id/resend`
- `DELETE /api/admin/invitations/:id`
- `GET /api/admin/validate-invite/:token`
- `POST /api/admin/accept-invite`
- `GET /api/admin/users`
- `PUT /api/admin/users/:id/role`
- `GET /api/admin/users/:id/sites`
- `PUT /api/admin/users/:id/sites`
- `DELETE /api/admin/users/:id`
- `GET /api/admin/settings`
- `PUT /api/admin/settings`
- `POST /api/admin/settings/test-email`
- `GET /api/admin/stats`

---

## Tech Stack

### Frontend
- React 18, TypeScript, Vite
- Tailwind CSS + shadcn/ui + Radix primitives
- React Router
- TanStack Query
- React Hook Form + Zod
- Vitest + Testing Library

### Backend
- Node.js, Express, TypeScript
- MySQL (`mysql2`)
- JWT auth
- `bcryptjs`
- Zod
- Helmet, CORS, Morgan
- Nodemailer

---

## Getting Started (Local)

### Prerequisites
- Node.js 18+
- npm
- MySQL server

### Install
```bash
npm run install:all
```

### Configure backend env
```bash
# Linux/macOS
cp backend/.env.example backend/.env

# Windows PowerShell
Copy-Item backend/.env.example backend/.env
```

Set at minimum:
- `JWT_SECRET`
- `MYSQL_HOST`
- `MYSQL_PORT`
- `MYSQL_USER`
- `MYSQL_PASSWORD`
- `MYSQL_DATABASE`

### Configure frontend env (optional)
```bash
# Linux/macOS
cp frontend/.env.example frontend/.env

# Windows PowerShell
Copy-Item frontend/.env.example frontend/.env
```

### Run dev
```bash
npm run dev
```

Default URLs:
- Frontend: `http://localhost:3000`
- Backend API: `http://localhost:3001/api`

### Setup wizard
Open the app and complete setup:
- Test connection
- Initialize DB
- Create initial admin (or reuse existing initialized DB)

---

## Environment Variables

### Backend (`backend/.env`)
- `PORT` (default `3001`)
- `NODE_ENV`
- `FRONTEND_URL`
- `APP_URL`
- `MYSQL_HOST`
- `MYSQL_PORT`
- `MYSQL_USER`
- `MYSQL_PASSWORD`
- `MYSQL_DATABASE`
- `MYSQL_SSL`
- `JWT_SECRET`
- `JWT_EXPIRES_IN`
- `JWT_REFRESH_EXPIRES_IN`
- `BCRYPT_ROUNDS`
- `SETUP_COMPLETE`
- Optional SMTP: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `SMTP_SECURE`

### Frontend (`frontend/.env`, optional)
- `VITE_API_URL` (dev override, default `http://localhost:3001/api`)
- `VITE_BASE_PATH`

---

## Scripts

### Root
```bash
npm run dev
npm run dev:frontend
npm run dev:backend
npm run build
npm run build:frontend
npm run build:backend
npm run preview
npm run install:all
```

### Frontend
```bash
cd frontend
npm run dev
npm run build
npm run test
npm run test:watch
npm run preview
```

### Backend
```bash
cd backend
npm run dev
npm run build
npm run start
npm run test
```

---

## Docker & Deployment

### Docker Compose
```bash
docker-compose up -d --build
```

Services:
- `mysql` (MySQL 8)
- `infradb` (Node 22 multi-stage app image)

Default host port:
- `${PORT:-3000}`

Production container serves frontend and backend together and exposes `/api/health`.

For Unraid-focused deployment details, see `docker/README.md` and `docker/unraid-template.xml`.

---

## Testing

### Frontend
```bash
cd frontend
npm run test
```

### Backend
```bash
cd backend
npm run test
```

Backend tests require a reachable MySQL test setup.
If MySQL is unavailable, errors such as `ECONNREFUSED 127.0.0.1:3306` are expected.

Windows helper script for containerized MySQL test runs:
```powershell
./backend/scripts/test-mysql.ps1
```

Manual containerized test DB workflow:
```bash
docker compose -f docker-compose.test.yml up -d mysql_test
```

The test container exposes MySQL on `127.0.0.1:3307` (`infradb_test` / `infradb`).

---

## License

This project is licensed under **PolyForm Noncommercial 1.0.0**.
See `LICENSE` for terms.

---

## Appendix: API Endpoint Role/Scope Mapping

This table summarizes which global/site roles are required for each major API group. For detailed enforcement, see backend route/middleware code.

| API Group                | Required Role/Scope                |
|--------------------------|------------------------------------|
| `/api/auth/*`            | Any authenticated user             |
| `/api/users/*`           | Global Admin / User Management     |
| `/api/admin/*`           | Global Admin (some: Site Admin)    |
| `/api/sites/*`           | Site Admin / Site User (scoped)    |
| `/api/labels/*`          | Site Admin / Site User (scoped)    |
| `/api/setup/*`           | No auth (setup phase only)         |

**Notes:**
- Global Admin can access all admin/user management endpoints.
- Site Admin can access site-scoped endpoints for their sites.
- Site User can access site-scoped endpoints for their sites, but not admin/config endpoints.
- Some endpoints (e.g., `/api/auth/me`, `/api/auth/logout`) are available to any authenticated user.
- Setup endpoints are only available before setup completion.
