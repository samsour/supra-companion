import { Suspense, lazy } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import DriveScreen from './features/drive/DriveScreen'
import JoinScreen from './features/join/JoinScreen'
import LobbyScreen from './features/lobby/LobbyScreen'
import ProfileScreen from './features/profile/ProfileScreen'
import ResultsScreen from './features/results/ResultsScreen'
import { SessionProvider } from './session'

const RouteEditorScreen = lazy(() => import('./features/route/RouteEditorScreen'))
const WatchScreen = lazy(() => import('./features/watch/WatchScreen'))

export default function App() {
  return (
    <SessionProvider>
      <BrowserRouter>
        <Suspense fallback={<div className="splash">Loading…</div>}>
          <Routes>
            <Route path="/" element={<JoinScreen />} />
            <Route path="/join/:code" element={<JoinScreen />} />
            <Route path="/profile" element={<ProfileScreen />} />
            <Route path="/watch/:code" element={<WatchScreen />} />
            <Route path="/trip/:tripId" element={<LobbyScreen />} />
            <Route path="/trip/:tripId/route" element={<RouteEditorScreen />} />
            <Route path="/trip/:tripId/results" element={<ResultsScreen />} />
            <Route path="/trip/:tripId/drive" element={<DriveScreen />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </SessionProvider>
  )
}
