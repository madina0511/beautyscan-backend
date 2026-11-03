# BeautyScan AI Backend

![NestJS](https://img.shields.io/badge/NestJS-10-E0234E?logo=nestjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![MongoDB](https://img.shields.io/badge/MongoDB-Mongoose-47A248?logo=mongodb&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-24_LTS-339933?logo=nodedotjs&logoColor=white)

Backend for cosmetics product photography and evidence-grounded product descriptions. Built with NestJS, TypeScript, GraphQL, MongoDB and JWT authentication.

## Key features

- **Photo Studio:** Photoroom background removal and professional product-photo enhancement.
- **Guest preview:** one free image enhancement, with authenticated claiming and saving.
- **Packaging intelligence:** Google Vision OCR and OpenRouter AI descriptions grounded in packaging evidence.
- **Four languages:** Uzbek, English, Korean and Russian; generate one selected description language at a time.
- **Secure accounts:** JWT access tokens, HttpOnly refresh cookies and ownership checks.
- **Product history:** saved images and multilingual descriptions with protected media access.

## Tech stack

NestJS 10 / TypeScript / GraphQL + REST / MongoDB + Mongoose / JWT + Passport / Sharp / Jest

## Quick start

Requires **Node.js 24.22.2**, **npm 11.19.1** and a running MongoDB instance.

```bash
git clone https://github.com/madina0511/beautyscan-backend.git
cd beautyscan-backend
npm ci
```

Create a private `.env` in the project root. Configure these settings with your own values:

| Settings | Purpose |
| --- | --- |
| `MONGO_URI` | MongoDB connection |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_EXPIRES_IN` | Independent secret of at least 32 bytes; refresh duration, e.g. `7d` |
| `FRONTEND_URL` | Frontend origin; locally `http://localhost:3001` |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | Email delivery and password-reset workflows |
| `GOOGLE_APPLICATION_CREDENTIALS` | Private Google Vision service-account path, or use Application Default Credentials |
| `OPENROUTER_API_KEY` | AI description generation |
| `PHOTOROOM_API_KEY` | Local sandbox image processing |
| `PHOTOROOM_DAILY_CALL_LIMIT`, `PHOTOROOM_MAX_CONCURRENT` | Positive limits; maximum 100 daily calls and 4 concurrent calls |
| `PHOTOROOM_GUEST_ENABLED`, `PHOTOROOM_GUEST_HASH_SECRET` | Set `true` to enable guests; use a separate secret of at least 32 bytes |
| `PHOTOROOM_GUEST_IP_HOURLY_LIMIT`, `PHOTOROOM_GUEST_MAX_ACTIVE` | Positive guest limits; maximum 10 per IP/hour and 4 active |

Never commit environment files, credentials or uploaded images. Provider-backed operations may incur charges.

```bash
npm run start:dev
```

Default API: `http://localhost:3000/graphql`. Image and OCR workflows use REST controllers alongside GraphQL.

## Testing and build

```bash
npm test -- --runInBand
npm run test:cov
npx tsc --noEmit --incremental false
npm run build
npm run start:prod
```

Additional scripts: `npm run test:e2e` (requires configured services) and `npm run lint` (applies fixes).

For production, set `NODE_ENV=production`, configure HTTPS and the correct frontend origin, keep media storage private and persistent, and supply `PHOTOROOM_PRODUCTION_API_KEY` instead of the sandbox credential.

## Structure

`src/` contains feature modules, services, guards, schemas and unit tests. `test/` contains application e2e tests. `uploads/` holds private runtime media and is excluded from Git.

## Frontend

[BeautyScan AI Frontend](https://github.com/madina0511/beautyscan-frontend)

## Author

**Madina Burieva**
