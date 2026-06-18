# Arena Control 🏔

App web para control de producción de la Planta Las Piedras. Reemplaza el flujo manual del Excel.

**Stack:** Next.js 14 · TypeScript · Tailwind CSS · Supabase · NextAuth.js · Azure AD · Vercel

> 🔒 **Acceso restringido:** solo usuarios con cuenta Microsoft corporativa (@migrin.cl) pueden ingresar. Autenticación vía Azure Active Directory (Microsoft 365).

---

## Flujo de trabajo automatizado

| Antes (manual en Excel) | Ahora (en la app) |
|---|---|
| Ingresar Fecha, Hora, Pesómetro, Horómetro en "Datos Arena" | Formulario en **⛏ Arena** — todo calculado automáticamente |
| Ingresar volúmenes Cono 1-3 y Pilas 1-7 | Mismo formulario, con preview en tiempo real |
| Ingresar fierrillo, arrastrar fórmulas | Calculado automáticamente al guardar |
| Actualizar Query1 (despachos) | Subir Excel/CSV del ERP en **🚛 Despachos** |
| Arrastrar hoja "Diario" | Vista automática en **📅 Diario** |
| Agregar fila en "Informe" y arrastrar | Vista automática en **📊 Informe** |
| Actualizar colores y gráficos | Gráficos automáticos en el Informe |
| Seleccionar, imprimir, guardar, enviar correo | Descargar Excel desde Informe |

---

## Setup completo

### 0. Registrar la app en Azure AD (Microsoft Entra)

> Solo se hace una vez. Necesitas acceso de administrador al Microsoft 365 de la empresa, o pedirle a TI que lo haga.

1. Ir a [portal.azure.com](https://portal.azure.com) → **Microsoft Entra ID** → **App registrations** → **New registration**
2. Completar:
   - **Name:** `Arena Control`
   - **Supported account types:** _Accounts in this organizational directory only (Single tenant)_ ← **importante: solo empresa**
   - **Redirect URI:** Web → `http://localhost:3000/api/auth/callback/azure-ad` (para desarrollo)
3. Clic en **Register**
4. Copiar de la pantalla siguiente:
   - **Application (client) ID** → será `AZURE_AD_CLIENT_ID`
   - **Directory (tenant) ID** → será `AZURE_AD_TENANT_ID`
5. Ir a **Certificates & secrets** → **New client secret**
   - Description: `arena-control`
   - Expires: 24 months
   - Copiar el **Value** (¡solo aparece una vez!) → será `AZURE_AD_CLIENT_SECRET`
6. Cuando despliegues en Vercel, agregar también la URL de producción:
   - En la app de Azure → **Authentication** → **Add URI** → `https://arena-control.vercel.app/api/auth/callback/azure-ad`

### 1. Crear proyecto en Supabase

1. Ir a [supabase.com](https://supabase.com) → crear cuenta → **New Project**
2. Dar un nombre (ej: `arena-control`) y guardar la contraseña
3. Ir a **SQL Editor** → pegar el contenido de `supabase/schema.sql` → **Run**
4. Ir a **Settings → API** y copiar:
   - **Project URL**: `https://XXXXX.supabase.co`
   - **anon public key**: `eyJ...`

### 2. Configurar variables de entorno

Crear archivo `.env.local` en la raíz del proyecto (copiar desde `.env.example`):

```
NEXT_PUBLIC_SUPABASE_URL=https://XXXXX.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...

AZURE_AD_CLIENT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
AZURE_AD_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxx
AZURE_AD_TENANT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx

NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=    ← generar con: openssl rand -base64 32
```

### 3. Instalar y ejecutar localmente

```bash
cd arena-control
npm install
npm run dev
```

Abre [http://localhost:3000](http://localhost:3000)

### 4. Importar datos históricos

1. Ir a la página **⬆ Importar**
2. Seleccionar el archivo `Informe Producción Planta Arena.xlsx`
3. Hacer clic en **Iniciar importación**
4. Esperar que se complete (puede tardar 2-5 minutos según el tamaño)

---

## Publicar en Vercel (acceso desde celular y PC)

1. Crear cuenta en [vercel.com](https://vercel.com) (gratis)
2. Subir el código a GitHub:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/TU_USUARIO/arena-control.git
   git push -u origin main
   ```
3. En Vercel → **New Project** → importar desde GitHub → seleccionar `arena-control`
4. Agregar **todas** las variables de entorno (igual que `.env.local`), cambiando `NEXTAUTH_URL` a la URL de Vercel
5. **Deploy** → obtendrás una URL como `https://arena-control.vercel.app`
6. Volver a Azure AD → Authentication → agregar la URL de Vercel como Redirect URI adicional

---

## Uso diario

### Después de cada droneo (Arena):
1. Abrir la app → **⛏ Arena**
2. Ingresar: Fecha, Hora, Pesómetro, Horómetro, Fierrillo
3. Ingresar: Cono 1, Cono 2, Cono 3 y Pilas 1-7 del informe del drone
4. Ver el **preview calculado** a la derecha
5. Hacer clic en **Guardar** → los despachos se calculan automáticamente desde la base de datos

### Actualizar despachos del ERP:
1. Exportar el archivo de despachos desde tu ERP (equivalente a Query1)
2. Ir a **🚛 Despachos** → subir el archivo → **Importar**

### Ver el informe:
- **📅 Diario**: Vista por día con interpolación para días sin droneo
- **📊 Informe**: Tabla por cubicación y por semana + gráficos
- Botón **Descargar Excel** genera el informe en formato xlsx

---

## Fórmulas implementadas (Datos Arena)

Extraídas directamente del Excel original:

| Campo | Fórmula |
|---|---|
| Producción Pesómetro | `(Pesómetro_actual - Pesómetro_ant) × 0.85` |
| Horas Reales | `(FechaHora_actual - FechaHora_ant) × 24` |
| Detención | `Horas_Reales - Diferencia_Horómetro` |
| Conos (m³) | `Cono1 + Cono2 + Cono3` |
| Acopio (m³) | `Pila1 + ... + Pila7` |
| Inventario M³ | `Conos × 0.9 + Acopio` |
| Inventario Ton | `Inventario_M3 × 1.4` |
| Diferencia Inventario | `Inventario_Ton - Inv_Ton_ant + Fierrillo × 1.4` |
| Despachos Ton | SUMIFS sobre tabla `despachos`, artículo A36LGC, rango de fechas |
| Producción Drone | `Diferencia_Inventario + Despachos_Ton` |
| Productividad Drone | `Producción_Drone / Diferencia_Horómetro` |
| Cancha Vieja | `Conos × 1.4` |
| Cancha Nueva | `Acopio × 1.4` |

---

## Estructura del proyecto

```
arena-control/
├── supabase/
│   └── schema.sql          # Crear tablas en Supabase
├── src/
│   ├── app/
│   │   ├── page.tsx         # Dashboard
│   │   ├── arena/page.tsx   # Formulario entrada Arena
│   │   ├── cuarzo/page.tsx  # Formulario entrada Cuarzo
│   │   ├── despachos/page.tsx # Importar despachos ERP
│   │   ├── diario/page.tsx  # Vista diaria con interpolación
│   │   ├── informe/page.tsx # Informe + gráficos + descarga Excel
│   │   └── importar/page.tsx # Migración datos históricos
│   ├── components/
│   │   └── Navigation.tsx   # Barra de navegación responsive
│   ├── lib/
│   │   ├── supabase.ts      # Cliente Supabase
│   │   └── calculations.ts  # Fórmulas del Excel
│   └── types/
│       └── database.ts      # Tipos TypeScript
├── .env.example             # Template de variables de entorno
└── README.md
```
