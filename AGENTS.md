# arena-control — Contexto de Proyecto para AI

> Documento de contexto para trabajar con AI (Antigravity / Claude Code / Cursor).  
> Actualizado: 2026-08-03

---

## 1. Descripción General

**Nombre:** Fotogrametría Migrin (arena-control)  
**Tipo:** Next.js 14 PWA, App Router, TypeScript strict  
**Deploy:** Vercel  
**Repositorio:** monorepo en `arena-control/`  
**Propósito:** Control de producción y despachos de áridos en plantas mineras de Migrin. Registra vuelos de dron, stock de árena/cuarzo/peral/turco, despachos de camiones, y genera informes automáticos por correo.

---

## 2. Stack

| Capa | Tecnología |
|---|---|
| Framework | Next.js 14, App Router |
| Lenguaje | TypeScript (strict: true) |
| Auth | NextAuth.js + Azure AD (tenant El Alto) |
| Base de datos | Supabase (PostgreSQL + RLS) |
| Email | Microsoft Graph API (Mail.Send) |
| Archivos | Microsoft OneDrive / SharePoint vía Graph API |
| Estilos | Tailwind CSS |
| Deploy | Vercel |

---

## 3. Autenticación y Roles

### Flujo
- Login **solo** por Azure AD (`/login`)
- El tenant de Azure es de **El Alto / Gestión El Alto** — incluye cuentas `@migrin.cl` y `@gestionelalto.cl`
- Dominios permitidos configurados en Vercel: `ALLOWED_EMAIL_DOMAINS=migrin.cl,gestionelalto.cl`
- Al hacer login, `authOptions.ts` consulta tabla `usuarios` y asigna `rol` al JWT

### Roles
| Rol | Acceso |
|---|---|
| `admin` | Todo: registrar datos, configurar, exportar, ver informes |
| `viewer` | Solo lectura del dashboard y páginas públicas |
| `sin_acceso` | Autenticado en Azure pero sin fila activa en `usuarios`. **En la práctica se comporta igual que `viewer`**: nada en el código bloquea la lectura de datos para este rol, solo queda fuera de las secciones admin (`AdminGuard`, escrituras). Es intencional — cualquier persona con correo `@migrin.cl`/`@gestionelalto.cl` puede ver los datos en modo visualización aunque no esté en `usuarios`. |

### Regla crítica de seguridad
- `accessToken` de Azure **no va al cliente** — solo se accede vía `getToken({ req })` en API routes
- Todas las APIs que escriben datos verifican `session.user.rol !== "admin"` → 403
- El cliente del browser usa la **anon key** de Supabase (solo lectura)
- Las API routes usan **SUPABASE_SERVICE_ROLE_KEY** para bypasear RLS

---

## 4. Variables de Entorno (Vercel)

```
NEXTAUTH_URL=https://arena-control.vercel.app
NEXTAUTH_SECRET=...
AZURE_AD_CLIENT_ID=...
AZURE_AD_CLIENT_SECRET=...
AZURE_AD_TENANT_ID=...
ALLOWED_EMAIL_DOMAINS=migrin.cl,gestionelalto.cl
NEXT_PUBLIC_SUPABASE_URL=https://...supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
```

---

## 5. Estructura de Archivos

```
src/
├── app/
│   ├── page.tsx                    # Dashboard principal (Zona Sur + Zona Centro)
│   ├── arena/page.tsx              # Zona Sur: ingreso datos dron + despachos
│   ├── centro/page.tsx             # Zona Centro: ingreso registros Turco y Peral
│   ├── cuarzo/page.tsx             # Zona Sur: ingreso datos cuarzo
│   ├── despachos/page.tsx          # Vista y carga manual de despachos (admin)
│   ├── diario/page.tsx             # Diario de anotaciones
│   ├── informe/page.tsx            # Gestión y reenvío de informes por correo
│   ├── importar/page.tsx           # Importación masiva de datos
│   ├── login/page.tsx              # Página de login Azure AD
│   └── api/
│       ├── auth/[...nextauth]/     # NextAuth handler
│       ├── centro-data/route.ts    # GET registros Turco/Peral · POST insert (service role)
│       ├── despachos/
│       │   ├── import/route.ts     # Importación de despachos vía archivo
│       │   └── sync-sharepoint/route.ts  # Sincronización con BBDD Despachos.xlsx en OneDrive
│       ├── informe/
│       │   ├── notify-centro/route.ts    # Email automático Turco/Peral
│       │   ├── send-visual/route.ts      # Email informe Zona Sur
│       │   ├── email-pdf/route.ts        # Adjunta PDF al informe
│       │   ├── reenviar/route.ts         # Reenviar informe anterior
│       │   ├── recipients/route.ts       # CRUD destinatarios por planta
│       │   └── generate-report/route.ts  # Genera reporte PDF
│       ├── anotaciones/route.ts
│       ├── anotaciones-vuelos/route.ts
│       ├── vuelos/route.ts
│       ├── me/route.ts
│       └── chat/route.ts
├── components/
│   ├── AdminGuard.tsx              # Wrapper que bloquea a no-admin
│   ├── Navigation.tsx
│   ├── ChatBot.tsx
│   ├── EditArenaModal.tsx
│   ├── EditCuarzoModal.tsx
│   └── ...
├── lib/
│   ├── authOptions.ts              # Configuración NextAuth + lógica de roles
│   ├── supabase.ts                 # Cliente anon (browser)
│   ├── calculations.ts             # Fórmulas de producción (trasladadas desde Excel)
│   ├── apiGuard.ts                 # Helper: requireJson, requireAdmin
│   └── ...
├── hooks/
│   └── useViewerMode.ts
├── types/
│   ├── database.ts                 # Interfaces TypeScript para todas las tablas
│   └── next-auth.d.ts
└── middleware.ts                   # Protege todas las rutas excepto /login y /api/auth
```

---

## 6. Tablas de Supabase

### `usuarios`
| Campo | Tipo | Notas |
|---|---|---|
| id | uuid PK | auto |
| email | text UNIQUE | lowercase |
| nombre | text | |
| rol | text | 'admin' \| 'viewer' |
| activo | bool | false = sin acceso |
| created_at | timestamptz | |

### `registros_arena` (Zona Sur)
Campos clave: `fecha`, `hora`, `fecha_hora`, `pesometro`, `horometro`, `fierrillo`, `cono_1..3`, `pila_1..7`, más todos los calculados (`produccion_pesometro`, `horas_reales`, `detencion`, `inventario_ton`, `produccion_drone`, `productividad_drone`, etc.)

### `registros_cuarzo` (Zona Sur)
Similar a arena pero para cuarzo.

### `registros_turco` (Zona Centro — El Turco)
Campos: `fecha`, `hora`, `fecha_hora`, `arena_mina_m3/ton`, `tlh_m3/ton`, `esteril_m3/ton`, `grancilla_m3/ton`, `fierrillo_a_m3/ton`, `fierrillo_b_m3/ton`, `fierrillo_total_ton`, `notas`

### `registros_peral` (Zona Centro — El Peral)
Campos: `fecha`, `hora`, `fecha_hora`, `arena_mina_m3/ton`, `a22_m3/ton`, `a24_m3/ton`, `a25_m3/ton`, `a26_m3/ton`, `dmh_m3/ton`, `grancilla_m3/ton`, `stock_arena_humeda_ton`, `notas`
> Arena Húmeda siempre = `a24_ton + a25_ton + a26_ton` (aunque `stock_arena_humeda_ton` sea null)

### `despachos`
Campos: `tipo`, `doc_entry`, `n_documento`, `folio`, `fecha`, `hora`, `fecha_hora`, `cliente`, `nombre`, `articulo`, `descripcion`, `toneladas`, `toneladas_confirmadas`, `ton_final`, `precio`, `total`, `patente`, `patente_acoplado`, `rut_chofer`, `nombre_chofer`, `bodega_origen`, `bodega_destino`

**Constraints UNIQUE confirmados:**
- `UNIQUE(folio)` — existe en DB ✓
- `UNIQUE(doc_entry, articulo)` — **no existe** en DB ✗
- `UNIQUE(fecha_hora, articulo)` — **no existe** en DB ✗

### `configuracion`
Clave-valor. Claves relevantes:
- `report_recipients` — destinatarios Zona Sur (JSON)
- `turco_recipients` — destinatarios Turco (JSON)
- `peral_recipients` — destinatarios Peral (JSON)
- `sur_default_emails` / `turco_default_emails` / `peral_default_emails`

### `parametros`
Parámetros numéricos configurables (densidades, factores, metas).

### `diario_anotaciones`
Anotaciones diarias de texto libre.

### `anotaciones_vuelos` (PENDIENTE — no creada aún en DB)
```sql
CREATE TABLE anotaciones_vuelos (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  fecha date NOT NULL,
  planta text NOT NULL CHECK (planta IN ('turco', 'peral', 'piedras')),
  motivo text NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(fecha, planta)
);
```

---

## 7. Lógica de Negocios Clave

### Zona Sur (Arena / Cuarzo)
- Productividad: `produccion_drone / horas_reales` (meta ≥ 32 ton/hr)
- Inventario: suma de conos + pilas (meta ≥ 7.500 ton, alerta < 6.500 ton)
- Densidad arena: 1.4 ton/m³ · Cuarzo: 1.65 ton/m³
- Factor pesómetro: × 0.85

### Zona Centro
- **Turco y Peral** usan `/api/centro-data` POST con service role (anon key bloqueado por RLS)
- Después de guardar, se emite `window.dispatchEvent(new CustomEvent("centro:saved"))` para que el dashboard se refresque
- Dashboard también escucha `window.addEventListener("focus", handler)` para refrescar al volver a la pestaña

### Despachos — Sincronización OneDrive
Botón "Actualizar Despachos" en `arena/page.tsx` llama `POST /api/despachos/sync-sharepoint`.
- Busca `BBDD Despachos.xlsx` (o `.xlsm`) en todos los drives del usuario
- Parsea hoja `Consulta1` (o la primera disponible)
- Constraint UNIQUE real confirmada en DB: `despachos_doc_entry_articulo_unique` sobre `(doc_entry, articulo)` — **no** sobre `folio`. Usar siempre `onConflict: "doc_entry,articulo"` en cualquier upsert a esta tabla.
- El cliente del browser usa anon key: **solo lectura** — las escrituras van siempre por API

### Correos
- **Zona Sur:** `POST /api/informe/send-visual` — envía HTML + PDF adjunto
- **Zona Centro:** `POST /api/informe/notify-centro` — envía email al guardar Turco o Peral
- Arena Húmeda en email Peral: `kpis.stock_arena_humeda_ton ?? (a24_ton + a25_ton + a26_ton)`
- Destinatarios guardados en tabla `configuracion`; SEED de fallback en `recipients/route.ts`

---

## 8. Patrones Establecidos

### Escribir datos desde el cliente
```typescript
// ✓ CORRECTO — usar API route con service role
const res = await fetch("/api/centro-data", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ table: "registros_peral", record }),
});

// ✗ INCORRECTO — anon client bloqueado por RLS
const { data, error } = await supabase.from("registros_peral").insert(record);
```

### Verificar rol en API routes
```typescript
const session = await getServerSession(authOptions);
if (!session?.user)               return NextResponse.json({ error: "No autenticado" }, { status: 401 });
if (session.user.rol !== "admin") return NextResponse.json({ error: "Sin permisos" },   { status: 403 });
```

### Leer accessToken de Azure
```typescript
// ✓ En API route (server-side)
const token = await getToken({ req: request as Parameters<typeof getToken>[0]["req"] });
const accessToken = token?.accessToken as string | undefined;

// ✗ NO exponer al cliente vía session.user
```

---

## 9. Fixes Recientes (no repetir)

| Problema | Causa | Fix aplicado |
|---|---|---|
| `onConflict` error en Actualizar Despachos | Se asumió que `folio` era la constraint UNIQUE; la real es `despachos_doc_entry_articulo_unique` sobre `(doc_entry, articulo)` | Usar siempre `onConflict: "doc_entry,articulo"` — nunca `folio` ni `fecha_hora,articulo` |
| `duplicate key value violates ... despachos_doc_entry_articulo_unique` | Se reemplazó el upsert por INSERT directo (para "evitar ON CONFLICT"), pero la constraint sí existe y el INSERT plano chocó con ella | Volver a `upsert` normal con `onConflict: "doc_entry,articulo"` |
| Registros Peral/Turco no se guardaban | Anon client bloqueado por RLS — Supabase retornaba `{data:null, error:null}` (falso éxito) | Rutar inserts por `/api/centro-data` POST con service role |
| Arena Húmeda en email Peral mostraba `—` | `stock_arena_humeda_ton` null en registros viejos | `stockHumeda = kpis.stock_arena_humeda_ton ?? (a24+a25+a26)` |
| Dashboard no refrescaba tras guardar | No había evento de actualización | `window.dispatchEvent(new CustomEvent("centro:saved"))` + listener en dashboard |
| Login bloqueado para @gestionelalto.cl | `ALLOWED_EMAIL_DOMAIN` solo aceptaba un dominio | Cambiar a `ALLOWED_EMAIL_DOMAINS` con lista CSV |
| Felipe Pollock no podía entrar | No estaba en tabla `usuarios` | Agregado con `rol=viewer, activo=true` |
| `GET /api/informe/recipients` sin control de acceso | Devolvía nombres/emails reales de destinatarios sin chequear sesión — decisión: los datos de producción/KPI son visibles para cualquier empleado, pero la lista de destinatarios (contacto de personas puntuales) debe quedar solo para admin | Agregado chequeo `session.user.rol !== "admin"` → 403, igual al que ya tenía su PUT |

---

## 10. Tareas Pendientes

### Alta prioridad
- [ ] **Crear tabla `anotaciones_vuelos`** en Supabase (SQL en sección 6)
- [ ] **Ejecutar SQL de usuarios** — insertar todos los destinatarios de correo como `viewer` (ver sección 11)

### Media prioridad
- [ ] **Metas de stock mínimo** Turco/Peral — definir valores y mostrar en dashboard con semáforo
- [ ] **Acceso admin jtorres** — revisar rol en tabla `usuarios`
- [ ] **Botón exportar Excel** — datos consolidados Zona Sur + Zona Centro

### Baja prioridad / Ideas
- [ ] **Re-sincronizar despachos completo** después del fix de constraints
- [ ] **Historial de cambios** en registros (audit log)
- [ ] **Modo offline** para ingreso de datos sin conexión (PWA cache)

---

## 11. SQL Pendiente de Ejecutar en Supabase

### Crear tabla anotaciones_vuelos
```sql
CREATE TABLE anotaciones_vuelos (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  fecha date NOT NULL,
  planta text NOT NULL CHECK (planta IN ('turco', 'peral', 'piedras')),
  motivo text NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(fecha, planta)
);
```

### Insertar usuarios como viewer (todos los destinatarios de correo)
```sql
INSERT INTO usuarios (email, nombre, rol, activo) VALUES
  ('nmerino@migrin.cl',          'Nicolás Merino',           'viewer', true),
  ('ajofre@migrin.cl',           'Alejandro Jofré',          'viewer', true),
  ('daguilera@migrin.cl',        'Diego Aguilera',           'viewer', true),
  ('bveliz.molina@migrin.cl',    'Benjamín Véliz',           'viewer', true),
  ('jefeturnomlp@migrin.cl',     'Jefe Turno MLP',           'viewer', true),
  ('efernandez@migrin.cl',       'Esteban Fernández',        'viewer', true),
  ('rbernadot@migrin.cl',        'Reinaldo Bernadot',        'viewer', true),
  ('ajerez@migrin.cl',           'Aldo Jerez',               'viewer', true),
  ('lreyes@migrin.cl',           'Lucas Reyes',              'viewer', true),
  ('jefeturnoturco@migrin.cl',   'Jefe Turno Turco',         'viewer', true),
  ('cayala@migrin.cl',           'Cristian Ayala',           'viewer', true),
  ('amendez@migrin.cl',          'Alejandro Méndez',         'viewer', true),
  ('rpesce@gestionelalto.cl',    'Roberto Pesce Martínez',   'viewer', true),
  ('rconcha@gestionelalto.cl',   'Rodrigo Concha',           'viewer', true),
  ('rpe@gestionelalto.cl',       'Roberto Pesce Eguiguren',  'viewer', true),
  ('dcampos@gestionelalto.cl',   'Diego Campos',             'viewer', true),
  ('nlopez@gestionelalto.cl',    'Natalia López',            'viewer', true)
ON CONFLICT (email) DO UPDATE
  SET activo = true, rol = 'viewer'
  WHERE usuarios.rol <> 'admin';
```

### Verificar constraint folio en despachos (para diagnóstico)
```sql
SELECT conname, contype, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'despachos'::regclass;
```

---

## 12. Reglas de Desarrollo

1. **TypeScript strict** — no usar `any`, no ignorar errores de tipo
2. **Nunca exponer accessToken al cliente** — solo en API routes vía `getToken({ req })`
3. **Todos los writes** van por API routes con service role — no escritura directa desde browser con anon key
4. **Headers de seguridad:** `next.config.mjs` configura X-Frame-Options, CSP, HSTS, X-Content-Type-Options
5. **`ignoreBuildErrors: false`** — el build de Vercel falla si hay errores TypeScript o ESLint
6. **No `console.log` con emails, tokens o datos sensibles**
7. **Content-Type validation** en todas las API routes que reciben JSON
8. **PowerShell:** no usar `&&` para encadenar comandos — correr cada comando por separado
9. **Git:** siempre correr desde el directorio del proyecto, no desde la raíz del usuario

---

## 13. Flujo Git / Deploy

```bash
# Desde el directorio del proyecto:
cd "C:\Users\Sebastian Arce\OneDrive - El Alto\Ing Planificación y Control Gestión\Reporte_Informe_Productividad_Arenas\Drone\arena-control"

git add <archivos>
git commit -m "fix/feat: descripción"
git push
# Vercel despliega automáticamente al hacer push a main
```

---

*Generado desde sesión Cowork — Migrin arena-control*
