import { BrowserRouter, Routes, Route } from "react-router-dom"
import ProjectList from "@/pages/ProjectList"
import ProjectCreate from "@/pages/ProjectCreate"
import VideoAnnotator from "@/pages/workspace/VideoAnnotator"
import CropGallery from "@/pages/workspace/CropGallery"
import { Toaster } from "@/components/ui/sonner"
function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<ProjectList />} />
        <Route path="/projects/new" element={<ProjectCreate />} />
        <Route path="/projects/:projectId/videos/:videoId" element={<VideoAnnotator />} />
        <Route path="/projects/:projectId/gallery" element={<CropGallery />} />
      </Routes>
      <Toaster />
    </BrowserRouter>
  )
}

export default App
