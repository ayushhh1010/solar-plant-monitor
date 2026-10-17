import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth.jsx'
import { Layout, Loading } from './components/ui.jsx'
import Crew from './pages/Crew.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Devices from './pages/Devices.jsx'
import Login from './pages/Login.jsx'
import PlantDetail from './pages/PlantDetail.jsx'
import Plants from './pages/Plants.jsx'
import TicketDetail from './pages/TicketDetail.jsx'
import TicketNew from './pages/TicketNew.jsx'
import Tickets from './pages/Tickets.jsx'
import './styles.css'

const DeviceDetail = lazy(() => import('./pages/DeviceDetail.jsx')) // keeps the charting library out of the main bundle

function App() {
  const { user, meta } = useAuth()
  if (user === undefined) return <Loading />
  if (!user) return <Login />
  if (!meta) return <Loading />
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="plants" element={<Plants />} />
        <Route path="plants/:id" element={<PlantDetail />} />
        <Route path="devices" element={<Devices />} />
        <Route path="devices/:id" element={<Suspense fallback={<Loading />}><DeviceDetail /></Suspense>} />
        <Route path="crew" element={<Crew />} />
        <Route path="tickets" element={<Tickets />} />
        <Route path="tickets/new" element={<TicketNew />} />
        <Route path="tickets/:id" element={<TicketDetail />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
