# Architecture Overview: Email Automation Platform

This document describes the architectural principles and structural organization established in Phase 1 for the Email Automation Platform.

---

## 1. Core Architectural Separation

The platform enforces a strict 3-tier boundary across concerns to ensure maintainability, scalability, and seamless extensibility in future phases:

```
┌─────────────────────────────────────────────────────────────┐
│                      1. Frontend / UI                       │
│  - app/ (Next.js App Router: layouts, routes, loading)       │
│  - components/ui/ (Atomic, reusable UI design primitives)   │
│  - components/layout/ (Header, Sidebar, Navigation shells)  │
└──────────────────────────────┬──────────────────────────────┘
                               │ HTTP / Server Actions
┌──────────────────────────────▼──────────────────────────────┐
│                    2. Server & API Layer                    │
│  - app/api/ (Thin route handlers, parameter parsing, HTTP)   │
│  - server/services/ (Pure domain business logic)            │
│  - server/repositories/ (Data access layer contracts)       │
└──────────────────────────────┬──────────────────────────────┘
                               │ Types / Config / Helpers
┌──────────────────────────────▼──────────────────────────────┐
│                 3. Shared Types & Utilities                 │
│  - types/ (Shared domain models and contracts)              │
│  - lib/config/ (Application & environment configuration)     │
│  - lib/utils/ (Pure utility functions)                      │
│  - lib/validations/ (Validation guards & schemas)           │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Layer Responsibilities

### 2.1 Frontend / UI Layer (`app/`, `components/`)
- **Responsibility**: Presentational rendering, responsive shells, and client-side interactions.
- **Constraints**:
  - Zero direct database access from UI components.
  - UI components consume shared configurations and types from `@/types` and `@/lib`.
  - Accessible primitives in `components/ui/` have no coupled business logic.

### 2.2 Server / API Layer (`app/api/`, `server/`)
- **API Handlers (`app/api/`)**: Act strictly as thin translation layers that validate requests and delegate to server services.
- **Services (`server/services/`)**: Encapsulate pure business logic (e.g. health evaluations, campaign scheduling, follow-up logic).
- **Repositories (`server/repositories/`)**: Abstract database operations behind standard contracts (`BaseRepository<T>`), isolating persistence technology from business logic.

### 2.3 Shared Layer (`types/`, `lib/`)
- Contains zero external side-effects.
- Declares strict TypeScript interfaces used across both client and server layers.

---

## 3. Phase 1 Foundation Scope

The following foundational artifacts are implemented in Phase 1:
- **Routes**: `/`, `/dashboard`, `/settings` (UI shells).
- **API**: `GET /api/health` returning `{ "status": "ok", "service": "email-automation-platform" }`.
- **Design System**: Tailwind CSS v4 with custom responsive header, sidebar, badges, buttons, and cards.
- **Quality Gates**: Strict TypeScript (`strict: true`), ESLint with Next.js Core Web Vitals, and zero bundle bloat.

---

## 4. Future Phase Integration Strategy

- **Phase 2 (Database & Persistence)**:
  Implement concrete repositories in `server/repositories/` conforming to `BaseRepository<T>` without restructuring route handlers.
- **Phase 3 (Outbound Dispatch & Workers)**:
  Implement delivery adapters under `server/services/delivery/` for providers (SES, Resend, SMTP) and background worker queues.
- **Phase 4 (Reply Tracking & Inbox Analysis)**:
  Introduce inbound webhook consumers under `app/api/webhooks/` feeding into `server/services/replies/`.
