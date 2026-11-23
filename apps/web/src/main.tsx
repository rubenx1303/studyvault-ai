import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { Layout } from './components/Layout';
import './index.css';
import { ArchitecturePage } from './pages/Architecture';
import { AssistantPage } from './pages/Assistant';
import { ChangesPage } from './pages/Changes';
import { Dashboard } from './pages/Dashboard';
import { DocumentsPage } from './pages/Documents';
import { DocumentViewer } from './pages/DocumentViewer';
import { ExamPage } from './pages/Exam';
import { MessagesPage } from './pages/Messages';
import { RecordingPage } from './pages/Recording';
import { SearchPage } from './pages/Search';
import { SourcesPage } from './pages/Sources';
import { StudyPage } from './pages/Study';
import { SubjectPage } from './pages/Subject';
import { TaskPage } from './pages/Task';
import { TasksPage } from './pages/Tasks';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false } },
});

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: '/', element: <Dashboard /> },
      { path: '/changes', element: <ChangesPage /> },
      { path: '/tasks', element: <TasksPage /> },
      { path: '/tasks/:id', element: <TaskPage /> },
      { path: '/messages', element: <MessagesPage /> },
      { path: '/documents', element: <DocumentsPage /> },
      { path: '/documents/:id', element: <DocumentViewer /> },
      { path: '/subjects/:id', element: <SubjectPage /> },
      { path: '/recordings/:id', element: <RecordingPage /> },
      { path: '/search', element: <SearchPage /> },
      { path: '/assistant', element: <AssistantPage /> },
      { path: '/study', element: <StudyPage /> },
      { path: '/exam', element: <ExamPage /> },
      { path: '/sources', element: <SourcesPage /> },
      { path: '/architecture', element: <ArchitecturePage /> },
    ],
  },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
