/** @type {import('next').NextConfig} */
const nextConfig = {
  // SEC-5: Errores de TypeScript y ESLint deben fallar el build en producción.
  // Si hay errores pre-existentes que bloquean el build, corrígelos antes de
  // desactivar estas flags. No silenciar errores del compilador en producción.
  typescript: {
    ignoreBuildErrors: false,
  },
  eslint: {
    ignoreDuringBuilds: false,
  },

  env