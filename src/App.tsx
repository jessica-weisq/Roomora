import { Suspense, lazy } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { ProjectProvider } from './state/ProjectContext'
import { ThemeProvider } from './state/theme'
import { Upload } from './screens/Upload'
import { Review } from './screens/Review'
import { Build } from './screens/Build'
import { About } from './screens/About'

// three.js is large, so the viewer loads only when it's needed.
const Viewer = lazy(() => import('./screens/Viewer').then((m) => ({ default: m.Viewer })))

export default function App() {
  return (
    <ThemeProvider>
    <ProjectProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Upload />} />
          <Route path="/review" element={<Review />} />
          <Route path="/build" element={<Build />} />
          <Route path="/about" element={<About />} />
          <Route
            path="/view"
            element={
              <Suspense fallback={null}>
                <Viewer />
              </Suspense>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </ProjectProvider>
    </ThemeProvider>
  )
}
