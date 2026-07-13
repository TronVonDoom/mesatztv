import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Libraries from './pages/Libraries'
import Browse from './pages/Browse'
import LibraryView from './pages/LibraryView'
import ShowView from './pages/ShowView'
import Settings from './pages/Settings'
import Collections from './pages/Collections'
import Channels from './pages/Channels'
import ChannelEditor from './pages/ChannelEditor'
import Logos from './pages/Logos'
import Logs from './pages/Logs'

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="libraries" element={<Libraries />} />
        <Route path="browse" element={<Browse />} />
        <Route path="browse/:libraryId" element={<LibraryView />} />
        <Route path="browse/:libraryId/show/:show" element={<ShowView />} />
        <Route path="channels" element={<Channels />} />
        <Route path="channels/:id" element={<ChannelEditor />} />
        <Route path="collections" element={<Collections />} />
        <Route path="logos" element={<Logos />} />
        <Route path="logs" element={<Logs />} />
        <Route path="settings" element={<Settings />} />
      </Route>
    </Routes>
  )
}
