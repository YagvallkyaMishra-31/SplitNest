import { useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import './Layout.css';

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const initials = user?.name
    ? user.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
    : '?';

  return (
    <>
      <nav className="navbar">
        <div className="navbar-inner">
          <NavLink to="/dashboard" className="navbar-brand">
            SplitNest
          </NavLink>

          <div className="navbar-links">
            <NavLink to="/dashboard" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
              Dashboard
            </NavLink>
            <NavLink to="/import" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
              Import
            </NavLink>
          </div>

          <div className="navbar-right">
            <div className="user-info">
              <div className="user-avatar">{initials}</div>
              <span className="user-name">{user?.name}</span>
            </div>
            <button className="logout-btn" onClick={handleLogout}>
              Log out
            </button>
          </div>

          <button className="hamburger" onClick={() => setMobileOpen(!mobileOpen)}>
            {mobileOpen ? '✕' : '☰'}
          </button>
        </div>
      </nav>

      {mobileOpen && (
        <div className="mobile-menu">
          <NavLink to="/dashboard" className="nav-link" onClick={() => setMobileOpen(false)}>
            Dashboard
          </NavLink>
          <NavLink to="/import" className="nav-link" onClick={() => setMobileOpen(false)}>
            Import
          </NavLink>
          <div className="navbar-right">
            <div className="user-info">
              <div className="user-avatar">{initials}</div>
              <span className="user-name">{user?.name}</span>
            </div>
            <button className="logout-btn" onClick={handleLogout}>
              Log out
            </button>
          </div>
        </div>
      )}

      <main className="layout-content">
        <Outlet />
      </main>
    </>
  );
}
