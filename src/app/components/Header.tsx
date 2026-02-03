import { Link, useNavigate, useLocation } from 'react-router-dom';
import { LogOut, Search, LayoutDashboard } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { motion } from 'motion/react';

export function Header() {
  const { isAuthenticated, isAdmin, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  if (location.pathname === '/login' || location.pathname === '/') {
    return null;
  }

  return (
    <motion.header
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white/80 backdrop-blur-lg border-b border-indigo-100 sticky top-0 z-50"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          <Link to="/" className="flex items-center gap-2 group min-w-0">
            <div className="group-hover:scale-105 transition-transform flex-shrink-0">
              <img src="/logo.png" alt="University Logo" className="size-8 sm:size-12 object-contain" />
            </div>
            <div className="min-w-0">
              <h1 className="font-semibold text-gray-900 text-sm sm:text-base truncate">Exam Seating Portal</h1>
              <p className="text-xs text-gray-500 hidden sm:block truncate">Seating Allocation System</p>
            </div>
          </Link>

          <nav className="flex items-center gap-2 sm:gap-4 flex-shrink-0 ml-2">
            <Link
              to="/student"
              className="flex items-center gap-2 px-3 py-2 text-gray-700 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
              title="Student Lookup"
            >
              <Search className="size-5" />
              <span className="hidden md:inline font-medium">Student Lookup</span>
            </Link>

            {isAuthenticated && isAdmin && (
              <>
                <Link
                  to="/admin"
                  className="flex items-center gap-2 px-3 py-2 text-gray-700 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                  title="Admin Dashboard"
                >
                  <LayoutDashboard className="size-5" />
                  <span className="hidden md:inline font-medium">Dashboard</span>
                </Link>
                <button
                  onClick={handleLogout}
                  className="flex items-center gap-2 px-3 py-2 bg-red-50 text-red-600 hover:bg-red-100 rounded-lg transition-colors"
                  title="Logout"
                >
                  <LogOut className="size-5" />
                  <span className="hidden md:inline font-medium">Logout</span>
                </button>
              </>
            )}
          </nav>
        </div>
      </div>
    </motion.header>
  );
}
