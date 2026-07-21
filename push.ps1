Set-Location "C:\Users\Sebastian Arce\OneDrive - El Alto\Ing Planificación y Control Gestión\Reporte_Informe_Productividad_Arenas\Drone\arena-control"
Remove-Item .git\index.lock -Force -ErrorAction SilentlyContinue
Remove-Item .git\HEAD.lock  -Force -ErrorAction SilentlyContinue
git restore --staged .
git add src/app/page.tsx
git add src/app/layout.tsx
git add src/app/diario/page.tsx
git add src/app/arena/page.tsx
git add src/app/informe/page.tsx
git add src/app/api/anotaciones/route.ts
git add src/app/api/chat/route.ts
git add src/app/api/centro-data/route.ts
git add src/app/api/informe/generate-report/route.ts
git add src/app/api/informe/reenviar/route.ts
git add src/app/api/informe/notify-centro/route.ts
git add src/types/database.ts
git add src/components/Navigation.tsx
git add src/components/OnboardingTour.tsx
git add src/components/AdminGuard.tsx
git add src/components/FloatingGuia.tsx
git add src/components/FloatingRefresh.tsx
git add src/hooks/useViewerMode.ts
git commit -m "feat: todos los cambios acumulados — zona centro, tour, chatbot, emails, refresh"
git push origin main
Write-Host "`nListo." -ForegroundColor Green
Read-Host "Presiona Enter para cerrar"
