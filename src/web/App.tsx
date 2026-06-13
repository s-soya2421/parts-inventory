import { Navigate, Route, Routes } from "react-router-dom";
import { AppLayout } from "./components/layout/AppLayout";
import { ScrollToTop } from "./components/ScrollToTop";
import { ExportPage } from "./routes/ExportPage";
import { ImportPage } from "./routes/ImportPage";
import { PartCreatePage } from "./routes/PartCreatePage";
import { PartDetailPage } from "./routes/PartDetailPage";
import { PartEditPage } from "./routes/PartEditPage";
import { PartsListPage } from "./routes/PartsListPage";
import { ProjectsListPage } from "./routes/ProjectsListPage";
import { ProjectDetailPage } from "./routes/ProjectDetailPage";
import { ProjectCreatePage } from "./routes/ProjectCreatePage";
import { ProjectEditPage } from "./routes/ProjectEditPage";
import { SettingsPage } from "./routes/SettingsPage";
import { CategoriesPage } from "./routes/CategoriesPage";
import { StatusesPage } from "./routes/StatusesPage";

import { FindPage } from "./routes/FindPage";
import { CategorySettingsPage } from "./routes/CategorySettingsPage";
import { AnalyticsPage } from "./routes/AnalyticsPage";

export default function App() {
  return (
    <AppLayout>
      <ScrollToTop />
      <Routes>
        <Route path="/" element={<Navigate to="/parts" replace />} />
        <Route path="/find" element={<FindPage />} />
        <Route path="/analytics" element={<AnalyticsPage />} />
        <Route path="/parts" element={<PartsListPage />} />
        <Route path="/parts/new" element={<PartCreatePage />} />
        <Route path="/parts/:id" element={<PartDetailPage />} />
        <Route path="/parts/:id/edit" element={<PartEditPage />} />
        <Route path="/projects" element={<ProjectsListPage />} />
        <Route path="/projects/new" element={<ProjectCreatePage />} />
        <Route path="/projects/:id" element={<ProjectDetailPage />} />
        <Route path="/projects/:id/edit" element={<ProjectEditPage />} />
        <Route path="/categories" element={<CategoriesPage />} />
        <Route path="/categories/:id/settings" element={<CategorySettingsPage />} />
        <Route path="/tags" element={<Navigate to="/categories?tab=tags" replace />} />
        <Route path="/statuses" element={<StatusesPage />} />
        <Route path="/import" element={<ImportPage />} />
        <Route path="/export" element={<ExportPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
    </AppLayout>
  );
}
