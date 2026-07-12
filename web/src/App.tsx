import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Libraries from './pages/Libraries'
import Browse from './pages/Browse'
import LibraryView from './pages/LibraryView'
import ShowView from './pages/ShowView'

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="libraries" element={<Libraries />} />
        <Route path="browse" element={<Browse />} />
        <Route path="browse/:libraryId" element={<LibraryView />} />
        <Route path="browse/:libraryId/show/:show" element={<ShowView />} />
      </Route>
    </Routes>
  )
}
