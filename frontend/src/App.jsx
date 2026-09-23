import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import NavBar from './components/NavBar.jsx';
import { LoadingIndicator } from './components/AsyncState.jsx';

const LoginPage = lazy(() => import('./pages/LoginPage.jsx'));
const SignupPage = lazy(() => import('./pages/SignupPage.jsx'));
const GenerateQuizPage = lazy(() => import('./pages/GenerateQuizPage.jsx'));
const GenerationProgressPage = lazy(() => import('./pages/GenerationProgressPage.jsx'));
const QuizLibraryPage = lazy(() => import('./pages/QuizLibraryPage.jsx'));
const QuizRunnerPage = lazy(() => import('./pages/QuizRunnerPage.jsx'));
const ResultsPage = lazy(() => import('./pages/ResultsPage.jsx'));
const DashboardPage = lazy(() => import('./pages/DashboardPage.jsx'));
const LeaderboardPage = lazy(() => import('./pages/LeaderboardPage.jsx'));
const BadgesPage = lazy(() => import('./pages/BadgesPage.jsx'));

function RequireAuth({ children }) {
  const { isAuthenticated, loading } = useAuth();
  if (loading) return null;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return children;
}

function Layout({ children }) {
  return (
    <div className="min-h-screen bg-slate-50">
      <NavBar />
      <main>{children}</main>
    </div>
  );
}

function AppRoutes() {
  return (
    <Layout>
      <Suspense fallback={<LoadingIndicator label="Loading…" fullPage />}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route
            path="/"
            element={
              <RequireAuth>
                <GenerateQuizPage />
              </RequireAuth>
            }
          />
          <Route
            path="/library"
            element={
              <RequireAuth>
                <QuizLibraryPage />
              </RequireAuth>
            }
          />
          {/* Waiting for a quiz has its own URL on purpose: the job lives in the database, so a
              refresh (or coming back later) resumes the progress view instead of losing it. */}
          <Route
            path="/quiz/generating/:generationId"
            element={
              <RequireAuth>
                <GenerationProgressPage />
              </RequireAuth>
            }
          />
          <Route
            path="/quiz/:id/run"
            element={
              <RequireAuth>
                <QuizRunnerPage />
              </RequireAuth>
            }
          />
          <Route
            path="/quiz/:id/results/:attemptId"
            element={
              <RequireAuth>
                <ResultsPage />
              </RequireAuth>
            }
          />
          <Route
            path="/dashboard"
            element={
              <RequireAuth>
                <DashboardPage />
              </RequireAuth>
            }
          />
          <Route
            path="/leaderboard"
            element={
              <RequireAuth>
                <LeaderboardPage />
              </RequireAuth>
            }
          />
          <Route
            path="/badges"
            element={
              <RequireAuth>
                <BadgesPage />
              </RequireAuth>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </Layout>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
