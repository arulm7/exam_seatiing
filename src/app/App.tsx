import { BrowserRouter, Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import { AuthProvider } from './contexts/AuthContext';
import { Header } from './components/Header';
import { ProtectedRoute } from './components/ProtectedRoute';
import { Home } from './pages/Home';
import { AdminLogin } from './pages/AdminLogin';
import { AdminDashboard } from './pages/AdminDashboard';
import { StudentLookup } from './pages/StudentLookup';

function NavigationController() {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    // Redirect to home if refreshing on the student lookup page
    if (location.pathname === '/student') {
      navigate('/', { replace: true });
    }
  }, []);

  return null;
}

export default function App() {
  return (
    <BrowserRouter>
      <NavigationController />
      <AuthProvider>
        <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-violet-50 to-purple-50">
          <Header />
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/student" element={<StudentLookup />} />
            <Route path="/login" element={<AdminLogin />} />
            <Route
              path="/admin"
              element={
                <ProtectedRoute>
                  <AdminDashboard />
                </ProtectedRoute>
              }
            />
          </Routes>
        </div>
      </AuthProvider>
    </BrowserRouter>
  );
}