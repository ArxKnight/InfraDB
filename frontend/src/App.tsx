import React from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { Toaster } from 'sonner'
import { AuthProvider } from './contexts/AuthContext'
import { ThemeProvider } from './contexts/ThemeContext'
import ProtectedRoute from './components/auth/ProtectedRoute'
import ErrorBoundary from './components/ErrorBoundary'
import Layout from './components/layout/Layout'
import AuthPage from './pages/AuthPage'
import InviteSignupPage from './pages/InviteSignupPage'
import ResetPasswordPage from './pages/ResetPasswordPage'
import SitesPage from './pages/SitesPage'
import ToolsPage from './pages/ToolsPage'
import ProfilePage from './pages/ProfilePage'
import AdminPage from './pages/AdminPage'
import SetupPage from './pages/SetupPage'
import NotFoundPage from './pages/NotFoundPage'
import ErrorPage from './pages/ErrorPage'
import SiteHubPage from './pages/SiteHubPage'
import SiteCablePage from './pages/SiteCablePage'
import SiteCableAdminPage from './pages/SiteCableAdminPage'
import SiteSidIndexPage from './pages/SiteSidIndexPage'
import SiteSidAdminPage from './pages/SiteSidAdminPage'
import SiteStockIndexPage from './pages/SiteStockIndexPage'
import SiteMapIndexPage from './pages/SiteMapIndexPage'
import SidDetailPage from './pages/SidDetailPage'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      retry: 1,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 1,
    },
  },
})

const routerFuture = {
  v7_startTransition: true,
  v7_relativeSplatPath: true,
} as const;

function App() {
  const [setupRequired, setSetupRequired] = React.useState<boolean | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);

  // Check if setup is required
  React.useEffect(() => {
    const checkSetupStatus = async () => {
      try {
        const response = await fetch('/api/setup/status');
        const result = await response.json();
        setSetupRequired(result.setupRequired);
      } catch (error) {
        console.error('Failed to check setup status:', error);
        // Assume setup is required if we can't check
        setSetupRequired(true);
      } finally {
        setIsLoading(false);
      }
    };

    checkSetupStatus();
  }, []);

  // Global error handlers
  React.useEffect(() => {
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      console.error('Unhandled promise rejection:', event.reason);
      // Don't show toast for network errors (already handled by API client)
      if (!event.reason?.message?.includes('Network error')) {
        // toast.error('An unexpected error occurred');
      }
    };

    const handleError = (event: ErrorEvent) => {
      console.error('Global error:', event.error);
    };

    window.addEventListener('unhandledrejection', handleUnhandledRejection);
    window.addEventListener('error', handleError);

    return () => {
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
      window.removeEventListener('error', handleError);
    };
  }, []);

  return (
    <ThemeProvider>
      {isLoading ? (
        <div className="min-h-screen flex items-center justify-center bg-background text-foreground">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-primary"></div>
        </div>
      ) : setupRequired ? (
        <SetupPage />
      ) : (
        <ErrorBoundary>
          <QueryClientProvider client={queryClient}>
            <AuthProvider>
              <Router future={routerFuture}>
                <div className="min-h-screen bg-background text-foreground">
                  <Routes>
                <Route path="/" element={<Navigate to="/sites" replace />} />
                
                {/* Auth routes */}
                <Route path="/auth/login" element={<AuthPage />} />
                <Route path="/auth/register" element={<InviteSignupPage />} />
                <Route path="/auth/reset-password" element={<ResetPasswordPage />} />
                
                {/* Error pages */}
                <Route path="/error" element={<ErrorPage />} />
                <Route path="/404" element={<NotFoundPage />} />
                
                {/* Protected routes with layout */}
                <Route
                  path="/dashboard"
                  element={
                    <ProtectedRoute>
                      <Navigate to="/sites" replace />
                    </ProtectedRoute>
                  }
                />
                <Route 
                  path="/sites" 
                  element={
                    <ProtectedRoute>
                      <Layout>
                        <SitesPage />
                      </Layout>
                    </ProtectedRoute>
                  } 
                />
                <Route 
                  path="/sites/:siteId" 
                  element={
                    <ProtectedRoute>
                      <Layout>
                        <SiteHubPage />
                      </Layout>
                    </ProtectedRoute>
                  } 
                />
                <Route 
                  path="/sites/:siteId/cable" 
                  element={
                    <ProtectedRoute>
                      <Layout>
                        <SiteCablePage />
                      </Layout>
                    </ProtectedRoute>
                  } 
                />
                <Route 
                  path="/sites/:siteId/cable/admin" 
                  element={
                    <ProtectedRoute>
                      <Layout>
                        <SiteCableAdminPage />
                      </Layout>
                    </ProtectedRoute>
                  } 
                />
                <Route 
                  path="/sites/:siteId/sid" 
                  element={
                    <ProtectedRoute>
                      <Layout>
                        <SiteSidIndexPage />
                      </Layout>
                    </ProtectedRoute>
                  } 
                />
                <Route 
                  path="/sites/:siteId/sid/admin" 
                  element={
                    <ProtectedRoute>
                      <Layout>
                        <SiteSidAdminPage />
                      </Layout>
                    </ProtectedRoute>
                  } 
                />
                <Route 
                  path="/sites/:siteId/sid/new" 
                  element={
                    <ProtectedRoute>
                      <Layout>
                        <SidDetailPage mode="create" />
                      </Layout>
                    </ProtectedRoute>
                  } 
                />
                <Route 
                  path="/sites/:siteId/sid/:sidId" 
                  element={
                    <ProtectedRoute>
                      <Layout>
                        <SidDetailPage />
                      </Layout>
                    </ProtectedRoute>
                  } 
                />
                <Route 
                  path="/sites/:siteId/stock" 
                  element={
                    <ProtectedRoute>
                      <Layout>
                        <SiteStockIndexPage />
                      </Layout>
                    </ProtectedRoute>
                  } 
                />
                <Route
                  path="/sites/:siteId/mapindex"
                  element={
                    <ProtectedRoute>
                      <Layout>
                        <SiteMapIndexPage />
                      </Layout>
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/labels"
                  element={
                    <ProtectedRoute>
                      <Navigate to="/sites" replace />
                    </ProtectedRoute>
                  }
                />
                <Route 
                  path="/tools" 
                  element={
                    <ProtectedRoute>
                      <Layout>
                        <ToolsPage />
                      </Layout>
                    </ProtectedRoute>
                  } 
                />
                <Route 
                  path="/port-labels" 
                  element={
                    <ProtectedRoute>
                      <Navigate to="/tools?tool=port" replace />
                    </ProtectedRoute>
                  } 
                />
                <Route 
                  path="/pdu-labels" 
                  element={
                    <ProtectedRoute>
                      <Navigate to="/tools?tool=pdu" replace />
                    </ProtectedRoute>
                  } 
                />
                <Route 
                  path="/profile" 
                  element={
                    <ProtectedRoute>
                      <Layout>
                        <ProfilePage />
                      </Layout>
                    </ProtectedRoute>
                  } 
                />
                <Route 
                  path="/admin" 
                  element={
                    <ProtectedRoute requireAdminAccess>
                      <Layout>
                        <AdminPage />
                      </Layout>
                    </ProtectedRoute>
                  } 
                />
                
                {/* Catch all - 404 */}
                <Route path="*" element={<NotFoundPage />} />
                  </Routes>
                </div>

                {/* Toast notifications */}
                <Toaster position="top-right" expand={false} richColors closeButton />
              </Router>
            </AuthProvider>
            <ReactQueryDevtools initialIsOpen={false} />
          </QueryClientProvider>
        </ErrorBoundary>
      )}
    </ThemeProvider>
  )
}

export default App