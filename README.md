# Email Automation Platform

> Production-grade Multi-Tenant Email Automation Platform

---

## 1. Project Name
**Email Automation Platform**

---

## 2. Project Purpose
**Email Automation Platform** is a multi-tenant email automation application where businesses can create an account, configure their email provider, manage contacts, create email sequences, run campaigns, track delivery events and manage follow-ups.

Payment is handled externally outside this application. This platform is focused entirely on email deliverability, safety controls, multi-tenancy, and reliable automation execution.

---

## 3. Technology Stack
- **Framework**: [Next.js](https://nextjs.org/) (App Router, React 19, Turbopack, Partial Prerendering)
- **Language**: [TypeScript](https://www.typescriptlang.org/) (Strict mode enabled)
- **Authentication**: [Supabase Auth](https://supabase.com/docs/guides/auth) + [@supabase/ssr](https://github.com/supabase/ssr) (Cookie-based session persistence)
- **Database**: [PostgreSQL](https://www.postgresql.org/) / [Supabase PostgreSQL](https://supabase.com/)
- **Security & Authorization**: PostgreSQL Row Level Security (RLS) with tenant security definer functions
- **Database Driver**: [`pg`](https://node-postgres.com/) (Node.js PostgreSQL driver)
- **Validation**: [Zod](https://zod.dev/)
- **In-Memory Testing**: `pg-mem` (Hermetic Postgres engine for CI/local testing)
- **Styling**: [Tailwind CSS](https://tailwindcss.com/)
- **Code Quality & Linting**: [ESLint](https://eslint.org/) (Next.js Core Web Vitals config)
- **Runtime**: [Node.js](https://nodejs.org/) (v20+)
- **Package Manager**: [npm](https://www.npmjs.com/)
- **Version Control**: [Git](https://git-scm.com/)

---

## 4. Installation Instructions
Clone the repository and install dependencies using npm:

```bash
git clone <repository-url>
cd "Email automation"
npm install
```

---

## 5. Development & Execution Commands

### Development Server
```bash
npm run dev
```
Accessible at:
- **Web UI Landing**: [http://localhost:3000](http://localhost:3000)
- **Sign In**: [http://localhost:3000/login](http://localhost:3000/login)
- **Register Workspace**: [http://localhost:3000/register](http://localhost:3000/register)
- **Protected Dashboard**: [http://localhost:3000/dashboard](http://localhost:3000/dashboard) (Redirects to `/login` if unauthenticated)
- **Protected Settings**: [http://localhost:3000/settings](http://localhost:3000/settings) (Redirects to `/login` if unauthenticated)
- **Health Endpoint**: [http://localhost:3000/api/health](http://localhost:3000/api/health)

### Quality & Build Commands
```bash
npm run lint          # Run ESLint across codebase (0 errors, 0 warnings)
npm run build         # Compile production bundle and type-check
npm run start         # Start local production server
npm test              # Run full 25-point test suite (Auth, Multi-Tenancy, Database, Schemas)
npm run test:db       # Run database-specific integration tests
```

---

## 6. Environment Variable Instructions
Configuration variables are defined in `.env.example`.
Copy this file to create your local environment file:

```bash
cp .env.example .env.local
```

### Environment Placeholders

| Variable | Description | Phase Status |
| :--- | :--- | :--- |
| `NODE_ENV` | Application environment (`development` / `production`) | Active |
| `PORT` | Web server port (Default: `3000`) | Active |
| `NEXT_PUBLIC_APP_URL` | Canonical application URL | Active |
| `DATABASE_URL` | PostgreSQL connection string | Active (Phase 2) |
| `SUPABASE_URL` | Supabase project API URL | Active (Phase 3) |
| `SUPABASE_ANON_KEY` | Supabase public anonymous API key | Active (Phase 3) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase administrative service role key | Active (Phase 3) |
| `AI_API_KEY` | Provider API key for future AI analysis | *Placeholder (Future phase)* |
| `EMAIL_PROVIDER_API_KEY` | Outbound email relay credentials (SES/Resend) | *Placeholder (Future phase)* |

> **Security Policy**: No real API keys, credentials, or production secrets are stored in this repository.

---

## 7. Phase 3 Authentication & Multi-Tenancy Architecture

### 7.1 Multi-Tenant Identity Model
The multi-tenancy hierarchy enforces strict business-level boundary scoping:

```
auth.users (Supabase Authentication)
    ↓ (id = auth.uid())
public.users (Application User Profile & Role)
    ↓ (business_id)
public.businesses (Isolated Organization Tenant)
    ↓ (business_id)
Business-Owned Entities:
├── leads
├── campaigns
├── campaign_steps
├── email_templates
├── email_messages
├── email_events
├── conversations
├── automation_runs
├── activities
└── suppressions
```

### 7.2 Server-Side Authorization & Anti-Spoofing
- **Zero Client Trust**: The frontend is NEVER permitted to supply an arbitrary `business_id` to access records.
- **Authoritative Scoping**: Every server request resolves the authenticated user session via `AuthService.getCurrentSession()`. The user's assigned `business_id` is derived server-side from PostgreSQL, guaranteeing that cross-tenant data requests are blocked at both application and database layers.

### 7.3 PostgreSQL Row Level Security (RLS)
RLS policies are defined in `supabase/migrations/20261015000003_auth_and_rls.sql` and `server/db/migrations/00003_auth_and_rls.sql`:

1. **Helper Function (`get_auth_business_id`)**:
   ```sql
   CREATE OR REPLACE FUNCTION get_auth_business_id()
   RETURNS UUID AS $$
     SELECT business_id FROM public.users WHERE id = auth.uid();
   $$ LANGUAGE sql STABLE SECURITY DEFINER;
   ```
2. **Helper Function (`is_auth_admin`)**:
   ```sql
   CREATE OR REPLACE FUNCTION is_auth_admin()
   RETURNS BOOLEAN AS $$
     SELECT role IN ('admin', 'owner') FROM public.users WHERE id = auth.uid();
   $$ LANGUAGE sql STABLE SECURITY DEFINER;
   ```
3. **Tenant Scoped Policies**:
   All 12 tables have RLS enabled with policies verifying `business_id = get_auth_business_id()`.

---

## 8. Authentication Flows & Routing

### 8.1 Registration Flow (`/register`)
1. User submits: Full Name, Business Name, Work Email, Password (min 6 chars).
2. `AuthService.register()`:
   - Validates input using `registerSchema` (Zod).
   - Creates authenticated Supabase user via `admin.auth.admin.createUser` with `email_confirm: true`.
   - Provisions isolated `businesses` workspace record.
   - Provisions `users` application profile assigned the `ADMIN` role and associated with the new `business_id`.
   - Authenticates session cookies on the HTTP response.
   - Redirects user to `/dashboard`.

### 8.2 Login Flow (`/login`)
1. User submits: Work Email, Password.
2. `AuthService.login()`:
   - Validates input using `loginSchema` (Zod).
   - Authenticates credentials against Supabase Auth.
   - Retrieves application user profile and associated business record.
   - Establishes session cookies.
   - Redirects user to `/dashboard` (or target protected route).

### 8.3 Route Protection & Middleware
Next.js Edge Middleware (`middleware.ts` & `lib/supabase/middleware.ts`) automatically intercepts incoming requests:
- **Protected Routes** (`/dashboard`, `/settings`): Unauthenticated visitors are redirected to `/login?redirect=<path>`.
- **Public Auth Routes** (`/login`, `/register`): Authenticated users are automatically redirected to `/dashboard`.
- **Public Endpoints** (`/`, `/api/health`, static assets): Accessible to all visitors.

### 8.4 Partial Prerendering (PPR) Architecture
Under Next.js 16 (`cacheComponents: true` and `partialPrefetching: true`), protected pages (`/dashboard`, `/settings`) use React `<Suspense>` boundaries. The static HTML layout shell is prerendered and served instantly, while authenticated user profile telemetry streams securely over HTTP.

---

## 9. Automated Testing Suite

The platform includes **25 automated tests** running in Node.js test runner:

```bash
npm test
```

### Test Breakdown
1. **Authentication & Multi-Tenancy Suite (`tests/auth.test.mjs`)**:
   - Registration input validation (email format, password length, required fields).
   - Login input validation.
   - Registration provisioning (verifying auth user, business creation, and ADMIN role assignment).
   - **MANDATORY Cross-Business Multi-Tenant Isolation Test**:
     - Provisions Tenant A (User A, Business A, Leads A, Campaign A).
     - Provisions Tenant B (User B, Business B, Leads B, Campaign B).
     - Verifies User A queries return ONLY Business A data (0 records from Tenant B).
     - Verifies User B queries return ONLY Business B data (0 records from Tenant A).
     - Verifies Attack Vector: Client passing arbitrary/spoofed `business_id` is overridden by server session.
   - Middleware route protection logic (unauthenticated redirection to `/login`, authenticated redirection to `/dashboard`).
2. **Database Foundation Suite (`tests/database.test.mjs`)**:
   - 12 core tables creation and schema verification.
   - Foreign key referential integrity and cascading deletes.
   - Composite unique constraints (`business_id, email`, `campaign_id, step_number`).
   - Multi-tenant suppression list scoping.
3. **Health Service Suite (`tests/health.test.mjs`)**:
   - Health endpoint payload and contract validation.
4. **Validation Schemas Suite (`tests/validation.test.mjs`)**:
   - Zod runtime validation across all domain entities.

---

## 10. Project Structure

```
email-automation-platform/
│
├── app/                              # Next.js App Router
│   ├── api/                          # API Route Handlers
│   │   ├── auth/                     # Authentication Endpoints
│   │   │   ├── login/route.ts        # POST /api/auth/login
│   │   │   ├── logout/route.ts       # POST /api/auth/logout
│   │   │   ├── me/route.ts           # GET /api/auth/me
│   │   │   └── register/route.ts     # POST /api/auth/register
│   │   └── health/route.ts           # GET /api/health
│   │
│   ├── dashboard/page.tsx            # Protected Dashboard (PPR + Suspense)
│   ├── settings/page.tsx             # Protected Settings (PPR + Suspense)
│   ├── login/page.tsx                # Public Sign In Page
│   ├── register/page.tsx             # Public Registration Page
│   ├── layout.tsx                    # Root application layout
│   ├── page.tsx                      # Public landing page
│   └── globals.css                   # Global styles & Tailwind
│
├── components/                       # Reusable UI components
│   ├── auth/
│   │   └── logout-button.tsx         # Client logout button component
│   ├── layout/
│   │   ├── footer.tsx                # Application footer
│   │   ├── header.tsx                # Responsive header with auth status
│   │   └── sidebar.tsx               # Navigation sidebar
│   └── ui/
│       ├── badge.tsx                 # Status badge component
│       ├── button.tsx                # Accessible button component
│       └── card.tsx                  # Content card component
│
├── lib/                              # Shared utilities & configurations
│   ├── config/
│   │   ├── env.ts                    # Typed environment access schema
│   │   └── site.ts                   # Site-wide navigation & branding config
│   ├── supabase/
│   │   ├── admin.ts                  # Supabase service role admin client
│   │   ├── client.ts                 # Browser client (createBrowserClient)
│   │   ├── middleware.ts             # Session refresh & route guard helper
│   │   └── server.ts                 # Server client with async cookies()
│   ├── utils/
│   │   └── cn.ts                     # Class name combination utility
│   └── validations/
│       ├── auth.ts                   # Zod schemas for register & login
│       ├── index.ts                  # Shared validation index
│       └── schemas.ts                # Zod validation schemas for core models
│
├── server/                           # Server domain & persistence layer
│   ├── db/
│   │   ├── migrations/               # SQL migration files
│   │   │   ├── 00001_core_schema.sql
│   │   │   ├── 00002_core_indexes.sql
│   │   │   └── 00003_auth_and_rls.sql
│   │   ├── seeds/                    # Development seed fixtures
│   │   │   └── dev_seed.sql
│   │   ├── client.ts                 # PostgreSQL client & connection pool
│   │   ├── migrate.ts                # Migration runner
│   │   ├── seed.ts                   # Seed runner
│   │   └── reset.ts                  # Database reset script
│   ├── repositories/                 # Data access repositories
│   │   ├── base.repository.ts        # Base repository contract
│   │   ├── business.repository.ts    # Business data access
│   │   ├── campaign.repository.ts    # Campaign data access
│   │   ├── lead.repository.ts        # Lead data access
│   │   ├── suppression.repository.ts # Suppression & opt-out data access
│   │   ├── user.repository.ts        # User profile data access
│   │   └── index.ts                  # Barrel export
│   └── services/
│       ├── auth.service.ts           # Authentication & multi-tenant provisioning
│       ├── health.service.ts         # Domain health check logic
│       └── index.ts                  # Service barrel export
│
├── supabase/                         # Supabase CLI compatibility
│   ├── migrations/
│   │   ├── 20261015000001_core_schema.sql
│   │   ├── 20261015000002_core_indexes.sql
│   │   └── 20261015000003_auth_and_rls.sql
│   └── seed.sql
│
├── types/                            # Shared TypeScript definitions
│   ├── database.ts                   # 12 core entity database domain models
│   ├── health.ts                     # Health API contracts
│   ├── navigation.ts                 # Navigation schemas
│   └── index.ts                      # Barrel types export
│
├── tests/                            # Automated test suites
│   ├── auth.test.mjs                 # Auth, multi-tenancy & isolation tests
│   ├── database.test.mjs             # 10-point database integrity test suite
│   ├── health.test.mjs               # Health service contract tests
│   ├── test-harness.mjs              # Hermetic database test harness
│   └── validation.test.mjs           # Zod schema validation tests
│
├── middleware.ts                     # Next.js root middleware
├── next.config.ts                    # Next.js compiler configuration
├── package.json                      # Project dependencies & scripts
├── README.md                         # Project documentation
└── tsconfig.json                     # Strict TypeScript configuration
```

---

## 11. Features Intentionally NOT Implemented Yet
In strict accordance with project boundaries, the following remain strictly out of scope:
- **Email Sending / Dispatch Workers**: Deferred to Phase 4
- **Campaign Execution Engine**: Deferred to Phase 4
- **Follow-up Automation Engine**: Deferred to Phase 4
- **AI Sentiment / Reply Handling**: Deferred to Phase 5
- **n8n Workflow Integrations**: Out of scope
- **WhatsApp Integration**: Out of scope
- **ChakraHQ Integration**: Out of scope
- **LinkedIn Automation**: Out of scope
- **Voice Calling / SMS**: Out of scope
- **Social Media Automation**: Out of scope
- **Billing & Payments**: Handled externally outside this application
