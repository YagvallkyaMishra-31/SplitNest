import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { api } from '../api/client.js';
import './Dashboard.css';

const AVATAR_COLORS = Array.from({ length: 8 }, (_, i) => `avatar-${i}`);

function formatDate() {
  return new Date().toLocaleDateString('en-IN', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
}

export default function Dashboard() {
  const { user } = useAuth();
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createDesc, setCreateDesc] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  const loadGroups = async () => {
    try {
      const data = await api.getGroups();
      setGroups(data.groups || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadGroups(); }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!createName.trim()) { setCreateError('Name is required'); return; }
    setCreating(true);
    setCreateError('');
    try {
      await api.createGroup({ name: createName.trim(), description: createDesc.trim() || undefined });
      setShowCreate(false);
      setCreateName('');
      setCreateDesc('');
      loadGroups();
    } catch (err) {
      setCreateError(err.message);
    } finally {
      setCreating(false);
    }
  };

  const getActiveMembers = (group) => {
    return (group.memberships || []).filter(m => !m.leftAt).map(m => m.user);
  };

  return (
    <div className="dashboard page">
      <div className="container">
        {/* Header */}
        <div className="dashboard-header animate-fade-in-up">
          <div className="dashboard-greeting">
            <h1>Welcome back, {user?.name} 👋</h1>
            <p>{formatDate()}</p>
          </div>
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
            + Create Group
          </button>
        </div>

        {/* Error */}
        {error && <div className="alert alert-error" style={{ marginBottom: 'var(--space-lg)' }}><span>⚠</span> {error}</div>}

        {/* Loading */}
        {loading && (
          <div className="groups-grid">
            {[1, 2, 3].map(i => (
              <div key={i} className={`skeleton-card animate-fade-in-up stagger-${i}`}>
                <div className="skeleton skeleton-line skeleton-line-short" />
                <div className="skeleton skeleton-line skeleton-line-long" />
                <div className="skeleton skeleton-line skeleton-line-xs" />
                <div className="skeleton-avatars">
                  {[1, 2, 3].map(j => <div key={j} className="skeleton skeleton-avatar" />)}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Groups Grid */}
        {!loading && groups.length > 0 && (
          <div className="groups-grid">
            {groups.map((group, idx) => {
              const members = getActiveMembers(group);
              const expenseCount = group._count?.expenses || 0;
              return (
                <Link
                  key={group.id}
                  to={`/groups/${group.id}`}
                  className={`group-card animate-fade-in-up stagger-${Math.min(idx + 1, 5)}`}
                >
                  <div className="group-card-name">{group.name}</div>
                  {group.description && (
                    <div className="group-card-desc">{group.description}</div>
                  )}
                  <div className="group-card-stats">
                    <span className="group-card-stat">👥 {members.length} member{members.length !== 1 ? 's' : ''}</span>
                    <span className="group-card-stat">💳 {expenseCount} expense{expenseCount !== 1 ? 's' : ''}</span>
                  </div>
                  <div className="group-card-members">
                    {members.slice(0, 5).map((m, i) => (
                      <div key={m.id} className={`member-avatar ${AVATAR_COLORS[i % 8]}`} title={m.name}>
                        {m.name?.[0]?.toUpperCase() || '?'}
                      </div>
                    ))}
                    {members.length > 5 && (
                      <div className="member-avatar member-avatar-overflow">+{members.length - 5}</div>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        )}

        {/* Empty State */}
        {!loading && groups.length === 0 && !error && (
          <div className="empty-state animate-fade-in-up">
            <div className="empty-state-icon">📋</div>
            <div className="empty-state-title">No groups yet</div>
            <div className="empty-state-text">Create your first expense group to start tracking shared expenses.</div>
            <button className="btn btn-primary" style={{ marginTop: 'var(--space-lg)' }} onClick={() => setShowCreate(true)}>
              + Create Group
            </button>
          </div>
        )}

        {/* Create Group Modal */}
        {showCreate && (
          <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) setShowCreate(false); }}>
            <div className="modal-card">
              <h2 className="modal-title">Create New Group</h2>
              {createError && <div className="alert alert-error" style={{ marginBottom: 'var(--space-md)' }}><span>⚠</span> {createError}</div>}
              <form className="modal-form" onSubmit={handleCreate}>
                <div className="input-group">
                  <label htmlFor="group-name">Group Name</label>
                  <input
                    id="group-name"
                    className="input-field"
                    placeholder='e.g., "Flat 4B" or "Goa Trip"'
                    value={createName}
                    onChange={(e) => setCreateName(e.target.value)}
                    autoFocus
                  />
                </div>
                <div className="input-group">
                  <label htmlFor="group-desc">Description (optional)</label>
                  <textarea
                    id="group-desc"
                    className="input-field"
                    rows={3}
                    placeholder="What's this group about?"
                    value={createDesc}
                    onChange={(e) => setCreateDesc(e.target.value)}
                    style={{ resize: 'vertical' }}
                  />
                </div>
                <div className="modal-actions">
                  <button type="button" className="btn btn-ghost" onClick={() => setShowCreate(false)}>Cancel</button>
                  <button type="submit" className="btn btn-primary" disabled={creating}>
                    {creating ? 'Creating…' : 'Create Group'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
