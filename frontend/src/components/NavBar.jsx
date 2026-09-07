import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

const LINKS = [
  { to: '/', label: 'Generate' },
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/leaderboard', label: 'Leaderboard' },
  { to: '/badges', label: 'Badges' },
];

export default function NavBar() {
  const { user, isAuthenticated, logout } = useAuth();
  const navigate = useNavigate();

  if (!isAuthenticated) {
    return (
      <nav className="flex items-center justify-between bg-slate-900 px-4 py-4 text-white sm:px-6">
        <Link to="/login" className="text-lg font-semibold">
          Quiz App
        </Link>
      </nav>
    );
  }

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <nav className="flex flex-wrap items-center justify-between gap-y-2 bg-slate-900 px-4 py-4 text-white sm:px-6">
      <div className="flex flex-wrap items-center gap-4 sm:gap-6">
        <span className="text-lg font-semibold">Quiz App</span>
        {LINKS.map((link) => (
          <Link key={link.to} to={link.to} className="text-sm text-slate-200 hover:text-white">
            {link.label}
          </Link>
        ))}
      </div>
      <div className="flex items-center gap-4">
        <span className="text-sm text-slate-300">{user?.name}</span>
        <button
          type="button"
          onClick={handleLogout}
          className="rounded bg-slate-700 px-3 py-1 text-sm hover:bg-slate-600"
        >
          Log out
        </button>
      </div>
    </nav>
  );
}
