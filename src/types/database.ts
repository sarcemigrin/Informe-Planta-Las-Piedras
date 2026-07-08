// Tipos TypeScript para las tablas de Supabase
// Generados manualmente a partir del schema.sql

export interface Database {
  public: {
    Tables: {
      registros_arena: {
        Row:    RegistroArena;
        Insert: RegistroArenaInsert;
        Update: Partial<RegistroArenaInsert>;
      };
      registros_cuarzo: {
        Row:    RegistroCuarzo;
        Insert: RegistroCuarzoInsert;
        Update: Partial<RegistroCuarzoInsert>;
      };
      despachos: {
        Row:    Despacho;
        Insert: DespachoInsert;
        Update: Partial<DespachoInsert>;
      };
      parametros: {
        Row:    Parametro;
        Insert: Parametro;
        Update: Partial<Parametro>;
      };
      usuarios: {
        Row:    { id: string; email: string; nombre: string | null; rol: string; activo: boolean; created_at: string };
        Insert: { email: string; nombre?: string | null; rol?: string; activo?: boolean };
        Update: { email?: string; nombre?: string | null; rol?: string; activo?: boolean };
      };
      configuracion: {
        Row:    { id: string; clave: string; valor: string; created_at: string };
        Insert: { clave: string; valor: string };
        Update: { clave?: string; valor?: string };
      };
      diario_anotaciones: {
        Row:    { id: string; fecha: string; texto: string; created_at: string };
        Insert: { fecha: string; texto: string };
        Update: { fecha?: string; texto?: string };
      };
    };
    Views: {
      vista_diario_arena: { Row: VistaDiarioArena };
    };
    Functions: Record<string, never>;
    Enums:     Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

// ---- Registros Arena ----
export interface RegistroArena {
  id: string;
  fecha: string;
  hora: string;
  fecha_hora: string;
  pesometro: number;
  horometro: number;
  fierrillo: number;
  cono_1: number;
  cono_2: number;
  cono_3: number;
  pila_1: number;
  pila_2: number;
  pila_3: number;
  pila_4: number;
  pila_5: number;
  pila_6: number;
  pila_7: number;
  // Calculados
  diferencia_pesometro: number | null;
  produccion_pesometro: number | null;
  diferencia_horometro: number | null;
  horas_reales: number | null;
  detencion: number | null;
  despachos_ton: number | null;
  cantidad_despachos: number | null;
  conos: number | null;
  acopio: number | null;
  inventario_m3: number | null;
  inventario_ton: number | null;
  diferencia_inventario: number | null;
  produccion_drone: number | null;
  productividad_drone: number | null;
  productividad_pesometro: number | null;
  productividad_hrs_reales: number | null;
  diferencia: number | null;
  cancha_vieja_ton: number | null;
  cancha_nueva_ton: number | null;
  notas: string | null;
  created_at: string;
  updated_at: string;
}

export type RegistroArenaInsert = Omit<RegistroArena, "id" | "created_at" | "updated_at">;

// ---- Registros Cuarzo ----
export interface RegistroCuarzo {
  id: string;
  fecha: string;
  hora: string;
  fecha_hora: string;
  pesometro: number | null;
  horometro: number;
  cono_1: number;
  cono_2: number;
  cono_3: number;
  diferencia_pesometro: number | null;
  produccion_pesometro: number | null;
  diferencia_horometro: number | null;
  horas_reales: number | null;
  detencion: number | null;
  despachos_ton: number | null;
  cantidad_despachos: number | null;
  conos: number | null;
  inventario_m3: number | null;
  inventario_ton: number | null;
  diferencia_inventario: number | null;
  produccion_drone: number | null;
  productividad_drone: number | null;
  productividad_pesometro: number | null;
  productividad_hrs_reales: number | null;
  diferencia: number | null;
  notas: string | null;
  created_at: string;
  updated_at: string;
}

export type RegistroCuarzoInsert = Omit<RegistroCuarzo, "id" | "created_at" | "updated_at">;

// ---- Despachos ----
export interface Despacho {
  id: string;
  tipo: string | null;
  doc_entry: number | null;
  n_documento: number | null;
  folio: number | null;
  fecha: string;
  hora: string;
  fecha_hora: string;
  cliente: string | null;
  nombre: string | null;
  articulo: string | null;
  descripcion: string | null;
  toneladas: number | null;
  toneladas_confirmadas: number | null;
  ton_final: number | null;
  precio: number | null;
  total: number | null;
  patente: string | null;
  patente_acoplado: string | null;
  rut_chofer: string | null;
  nombre_chofer: string | null;
  bodega_origen: string | null;
  bodega_destino: string | null;
  created_at: string;
}

export type DespachoInsert = Omit<Despacho, "id" | "created_at">;

// ---- Parametros ----
export interface Parametro {
  id: string;
  clave: string;
  valor: number;
  descripcion: string | null;
}

// ---- Vista Diario Arena ----
export interface VistaDiarioArena {
  fecha: string;
  semana: number;
  mes: number;
  anio: number;
  despachos_ton: number;
  despachos_ton_dia: number;
  viajes: number;
  viajes_dia: number;
  detencion_total: number;
  detencion_dia: number;
  produccion_pesometro_total: number;
  produccion_pesometro_dia: number;
  produccion_drone_total: number;
  produccion_drone_dia: number;
  horas_reales_total: number;
  horas_reales_dia: number;
  productividad_pesometro: number;
  productividad_drone: number;
  productividad_hrs_reales: number;
  fierrillo_total: number;
  fierrillo_dia: number;
  conos_total: number;
  conos_dia: number;
}
