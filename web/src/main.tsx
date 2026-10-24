import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { AppShell } from '@/components/layout/app-shell'
import { TooltipProvider } from '@/components/ui/primitives'
import { FindingsPage } from '@/pages/findings'
import { NotFoundPage } from '@/pages/not-found'
import { RunComparePage } from '@/pages/run-compare'
import { RunFailuresPage } from '@/pages/run-failures'
import { RunLogPage } from '@/pages/run-log'
import { RunMatrixPage } from '@/pages/run-matrix'
import { RunOverviewPage } from '@/pages/run-overview'
import { RunVariantPage } from '@/pages/run-variant'
import './index.css'

try { if (localStorage.getItem('theme') === 'dark') document.documentElement.classList.add('dark') } catch { /* storage blocked */ }

const queryClient = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } } })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <BrowserRouter basename={import.meta.env.BASE_URL}>
          <Routes>
            <Route element={<AppShell />}>
              <Route index element={<FindingsPage />} />
              <Route path="run/status" element={<RunOverviewPage />} />
              <Route path="run/matrix" element={<RunMatrixPage />} />
              <Route path="run/v" element={<RunVariantPage />} />
              <Route path="run/failures" element={<RunFailuresPage />} />
              <Route path="run/compare" element={<RunComparePage />} />
              <Route path="run/log" element={<RunLogPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  </StrictMode>,
)
