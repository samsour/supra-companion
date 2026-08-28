import { BrowserRouter, Route, Routes } from 'react-router-dom'
import DriveScreen from './features/drive/DriveScreen'
import JoinScreen from './features/join/JoinScreen'
import LobbyScreen from './features/lobby/LobbyScreen'
import { SessionProvider } from './session'

export default function App() {
  return (
    <SessionProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<JoinScreen />} />
          <Route path="/trip/:tripId" element={<LobbyScreen />} />
          <Route path="/trip/:tripId/drive" element={<DriveScreen />} />
        </Routes>
      </BrowserRouter>
    </SessionProvider>
  )
}
