---
trigger: always_on
---

- Todas las escrituras a Supabase van por API routes con SUPABASE_SERVICE_ROLE_KEY — NUNCA desde el cliente con anon key
- El accessToken de Azure NUNCA va al cliente — solo getToken({ req }) en server-side
- Verificar session.user.rol !== "admin" → 403 en toda API que escriba datos
- En tabla despachos usar siempre onConflict: "doc_entry,articulo" — es la única constraint UNIQUE real en DB (despachos_doc_entry_articulo_unique). NUNCA "folio" ni "fecha_hora,articulo"
- TypeScript strict: no usar any, no ignorar errores de tipo
- ignoreBuildErrors: false — el build debe pasar limpio