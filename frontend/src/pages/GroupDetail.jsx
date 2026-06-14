import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { api } from '../api/client.js';
import './GroupDetail.css';

const AVATAR_COLORS = Array.from({ length: 8 }, (_, i) => `avatar-${i}`);

function formatCurrency(n) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(n);
}
function formatDate(d) {
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function GroupDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const [group, setGroup] = useState(null);
  const [balances, setBalances] = useState(null);
  const [allExpenses, setAllExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('expenses');
  const [expandedExpense, setExpandedExpense] = useState(null);
  const [showAddExpense, setShowAddExpense] = useState(false);
  const [showSettle, setShowSettle] = useState(null);
  const [showAddMember, setShowAddMember] = useState(false);
  const [showSetLeftDate, setShowSetLeftDate] = useState(null);
  const [error, setError] = useState('');

  const loadData = useCallback(async () => {
    try {
      const [gData, bData, eData] = await Promise.all([
        api.getGroup(id),
        api.getGroupBalances(id),
        api.getExpenses({ groupId: id, limit: 200 }),
      ]);
      setGroup(gData.group);
      setBalances(bData);
      setAllExpenses(eData.expenses || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { loadData(); }, [loadData]);

  const activeMembers = group?.memberships?.filter(m => !m.leftAt).map(m => m.user) || [];
  const allMembers = group?.memberships?.map(m => m.user) || [];

  const handleDeleteExpense = async (expId, e) => {
    e.stopPropagation();
    if (!confirm('Delete this expense?')) return;
    try {
      await api.deleteExpense(expId);
      loadData();
    } catch (err) {
      alert(err.message);
    }
  };

  if (loading) {
    return (
      <div className="group-detail page">
        <div className="container">
          <div className="skeleton skeleton-line" style={{ width: 120, height: 14, marginBottom: 16 }} />
          <div className="skeleton skeleton-line" style={{ width: 280, height: 28, marginBottom: 8 }} />
          <div className="skeleton skeleton-line" style={{ width: 200, height: 14, marginBottom: 32 }} />
          {[1, 2, 3].map(i => (
            <div key={i} className="skeleton" style={{ height: 72, borderRadius: 10, marginBottom: 8 }} />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="group-detail page">
        <div className="container">
          <div className="alert alert-error"><span>⚠</span> {error}</div>
        </div>
      </div>
    );
  }

  // Build activity items from expenses and settlements
  const settlements = group?.settlements || [];
  const activityItems = [
    ...allExpenses.filter(e => !e.isDeleted).map(e => ({ type: 'expense', date: e.date, data: e })),
    ...settlements.map(s => ({ type: 'settlement', date: s.date, data: s })),
  ].sort((a, b) => new Date(b.date) - new Date(a.date));

  return (
    <div className="group-detail page">
      <div className="container animate-fade-in">
        {/* Header */}
        <div className="gd-header">
          <Link to="/dashboard" className="gd-back">← Dashboard</Link>
          <div className="gd-title-row">
            <div>
              <h1 className="gd-title">{group?.name}</h1>
              {group?.description && <p className="gd-description">{group.description}</p>}
            </div>
            <button className="btn btn-primary" onClick={() => setShowAddExpense(true)}>
              + Add Expense
            </button>
          </div>
          <div className="gd-members-row">
            {activeMembers.slice(0, 8).map((m, i) => (
              <div key={m.id} className={`member-avatar ${AVATAR_COLORS[i % 8]}`} title={m.name}>
                {m.name?.[0]?.toUpperCase()}
              </div>
            ))}
          </div>
        </div>

        {/* Tabs */}
        <div className="gd-tabs">
          {['expenses', 'balances', 'activity', 'members'].map(t => (
            <button
              key={t}
              className={`gd-tab ${tab === t ? 'active' : ''}`}
              onClick={() => setTab(t)}
            >
              {t === 'expenses' ? '💳 Expenses' : t === 'balances' ? '⚖️ Balances' : t === 'activity' ? '📊 Activity' : '👥 Members'}
            </button>
          ))}
        </div>

        {/* EXPENSES TAB */}
        {tab === 'expenses' && (
          <div className="animate-fade-in">
            {allExpenses.filter(e => !e.isDeleted).length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-icon">💳</div>
                <div className="empty-state-title">No expenses yet</div>
                <div className="empty-state-text">Add your first expense to start tracking.</div>
                <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => setShowAddExpense(true)}>
                  + Add Expense
                </button>
              </div>
            ) : (
              <div className="expense-list">
                {allExpenses.filter(e => !e.isDeleted).sort((a, b) => new Date(b.date) - new Date(a.date)).map((exp, idx) => (
                  <div
                    key={exp.id}
                    className={`expense-card animate-fade-in-up stagger-${Math.min(idx + 1, 5)}`}
                    onClick={() => setExpandedExpense(expandedExpense === exp.id ? null : exp.id)}
                  >
                    <div className="expense-row">
                      <div className="expense-left">
                        <div className="expense-desc">{exp.description}</div>
                        <div className="expense-meta">
                          <span>{formatDate(exp.date)}</span>
                          <span>·</span>
                          <span>Paid by {exp.paidBy?.name || 'Unknown'}</span>
                          <span className="badge badge-muted">{exp.splitType}</span>
                          {exp.csvRowNumber && <span className="badge badge-info">Row {exp.csvRowNumber}</span>}
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div className="expense-amount">{formatCurrency(exp.amount)}</div>
                        <button className="expense-delete" onClick={(e) => handleDeleteExpense(exp.id, e)} title="Delete">🗑</button>
                      </div>
                    </div>
                    {expandedExpense === exp.id && exp.splits && (
                      <div className="expense-splits">
                        {exp.splits.map(s => (
                          <div key={s.id} className="split-row">
                            <span>{s.user?.name || 'Unknown'}</span>
                            <span className="split-row-amount">{formatCurrency(s.amount)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* BALANCES TAB */}
        {tab === 'balances' && (
          <div className="animate-fade-in">
            {/* Outstanding Balances */}
            <div className="balances-section">
              <h3 className="balances-section-title">Outstanding Balances</h3>
              {(!balances?.balances || balances.balances.length === 0) ? (
                <div className="empty-state" style={{ padding: '32px 16px' }}>
                  <div className="empty-state-icon">✅</div>
                  <div className="empty-state-title">All settled up!</div>
                  <div className="empty-state-text">No outstanding balances in this group.</div>
                </div>
              ) : (
                <div className="balance-list">
                  {balances.balances.map((b, i) => {
                    const isMe = b.from.id === user?.id;
                    return (
                      <div key={i} className={`balance-card animate-fade-in-up stagger-${Math.min(i + 1, 5)}`}>
                        <div className="balance-flow">
                          <span style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>{b.from.name}</span>
                          <span className="balance-arrow">→</span>
                          <span style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>{b.to.name}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <div className={`balance-amount ${isMe ? 'owes' : 'owed'}`}>
                            {formatCurrency(b.amount)}
                          </div>
                          <button className="btn btn-sm btn-success" onClick={() => setShowSettle({ from: b.from, to: b.to, amount: b.amount })}>
                            Settle
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Settlement Suggestions */}
            {balances?.suggestions && balances.suggestions.length > 0 && (
              <div className="balances-section">
                <h3 className="balances-section-title">💡 Simplified Settlements</h3>
                <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', marginBottom: 'var(--space-md)' }}>
                  Minimum transfers to settle all debts:
                </p>
                <div className="balance-list">
                  {balances.suggestions.map((s, i) => (
                    <div key={i} className={`suggestion-card animate-fade-in-up stagger-${Math.min(i + 1, 5)}`}>
                      <div className="balance-flow">
                        <span style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>{s.from.name}</span>
                        <span style={{ color: 'var(--color-accent-emerald)' }}>pays</span>
                        <span style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>{s.to.name}</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div className="balance-amount owed">{formatCurrency(s.amount)}</div>
                        <button className="btn btn-sm btn-primary" onClick={() => setShowSettle({ from: s.from, to: s.to, amount: s.amount })}>
                          Record
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ACTIVITY TAB */}
        {tab === 'activity' && (
          <div className="animate-fade-in">
            {activityItems.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-icon">📊</div>
                <div className="empty-state-title">No activity yet</div>
              </div>
            ) : (
              <div className="activity-list">
                {activityItems.map((item, idx) => (
                  <div key={idx} className={`activity-item animate-fade-in-up stagger-${Math.min(idx + 1, 5)}`}>
                    <div className={`activity-icon ${item.type}`}>
                      {item.type === 'expense' ? '💰' : '🤝'}
                    </div>
                    <div className="activity-content">
                      <div className="activity-title">
                        {item.type === 'expense'
                          ? item.data.description
                          : `${item.data.paidBy?.name} paid ${item.data.paidTo?.name}`}
                      </div>
                      <div className="activity-subtitle">
                        {formatDate(item.date)}
                        {item.type === 'expense' && ` · Paid by ${item.data.paidBy?.name || 'Unknown'}`}
                      </div>
                    </div>
                    <div className="activity-amount" style={{
                      color: item.type === 'settlement' ? 'var(--color-accent-violet)' : 'var(--color-text-primary)'
                    }}>
                      {formatCurrency(item.data.amount)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ADD EXPENSE MODAL */}
        {showAddExpense && (
          <AddExpenseModal
            groupId={id}
            members={activeMembers}
            currentUser={user}
            onClose={() => setShowAddExpense(false)}
            onCreated={() => { setShowAddExpense(false); loadData(); }}
          />
        )}

        {/* SETTLE MODAL */}
        {showSettle && (
          <SettleModal
            groupId={id}
            from={showSettle.from}
            to={showSettle.to}
            amount={showSettle.amount}
            onClose={() => setShowSettle(null)}
            onSettled={() => { setShowSettle(null); loadData(); }}
          />
        )}

        {/* MEMBERS TAB */}
        {tab === 'members' && (
          <div className="animate-fade-in">
            <div className="gd-title-row" style={{ marginBottom: 'var(--space-md)' }}>
              <div>
                <h3 className="balances-section-title" style={{ margin: 0 }}>Group Members</h3>
                <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>
                  Manage active and former participants of this group.
                </p>
              </div>
              <button className="btn btn-primary" onClick={() => setShowAddMember(true)}>
                + Add Member
              </button>
            </div>

            {/* Active Members */}
            <div className="balances-section" style={{ marginBottom: 'var(--space-lg)' }}>
              <h4 className="balances-section-title">Active Members ({group?.memberships?.filter(m => !m.leftAt).length || 0})</h4>
              <div className="member-list">
                {group?.memberships?.filter(m => !m.leftAt).map((m, i) => (
                  <div key={m.id} className="member-card animate-fade-in-up" style={{ animationDelay: `${i * 0.05}s` }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div className={`member-avatar ${AVATAR_COLORS[i % 8]}`}>
                        {m.user?.name?.[0]?.toUpperCase()}
                      </div>
                      <div>
                        <div style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>{m.user?.name}</div>
                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>{m.user?.email}</div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                        Joined {formatDate(m.joinedAt)}
                      </span>
                      {group?.memberships?.filter(m => !m.leftAt).length > 1 && (
                        <button className="btn btn-sm btn-ghost btn-danger" onClick={() => setShowSetLeftDate(m)}>
                          Set Left Date
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Former Members */}
            {group?.memberships?.some(m => m.leftAt) && (
              <div className="balances-section">
                <h4 className="balances-section-title">Former Members ({group?.memberships?.filter(m => m.leftAt).length || 0})</h4>
                <div className="member-list">
                  {group?.memberships?.filter(m => m.leftAt).map((m, i) => (
                    <div key={m.id} className="member-card former animate-fade-in-up" style={{ animationDelay: `${i * 0.05}s` }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, opacity: 0.7 }}>
                        <div className="member-avatar avatar-muted">
                          {m.user?.name?.[0]?.toUpperCase()}
                        </div>
                        <div>
                          <div style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>{m.user?.name}</div>
                          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>{m.user?.email}</div>
                        </div>
                      </div>
                      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                        {formatDate(m.joinedAt)} — {formatDate(m.leftAt)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ADD MEMBER MODAL */}
        {showAddMember && (
          <AddMemberModal
            groupId={id}
            existingMembers={allMembers}
            onClose={() => setShowAddMember(false)}
            onAdded={() => { setShowAddMember(false); loadData(); }}
          />
        )}

        {/* SET LEFT DATE MODAL */}
        {showSetLeftDate && (
          <SetLeftDateModal
            groupId={id}
            membership={showSetLeftDate}
            onClose={() => setShowSetLeftDate(null)}
            onSaved={() => { setShowSetLeftDate(null); loadData(); }}
          />
        )}
      </div>
    </div>
  );
}

/* ── Add Expense Modal ── */
function AddExpenseModal({ groupId, members, currentUser, onClose, onCreated }) {
  const [desc, setDesc] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [paidById, setPaidById] = useState(currentUser?.id || '');
  const [splitType, setSplitType] = useState('equal');
  const [participants, setParticipants] = useState(
    members.reduce((acc, m) => ({ ...acc, [m.id]: { checked: true, value: '' } }), {})
  );
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const toggleParticipant = (uid) => {
    setParticipants(p => ({ ...p, [uid]: { ...p[uid], checked: !p[uid].checked } }));
  };
  const setParticipantValue = (uid, val) => {
    setParticipants(p => ({ ...p, [uid]: { ...p[uid], value: val } }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!desc.trim() || !amount || !date) {
      setError('Please fill in required fields.');
      return;
    }
    const checked = Object.entries(participants).filter(([, v]) => v.checked);
    if (checked.length === 0) {
      setError('Select at least one participant.');
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      const body = {
        groupId,
        date,
        description: desc.trim(),
        amount: parseFloat(amount),
        paidById: paidById || undefined,
        splitType,
        notes: notes.trim() || undefined,
      };

      if (splitType === 'equal') {
        body.participants = checked.map(([uid]) => uid);
      } else if (splitType === 'unequal') {
        body.splitDetails = checked.map(([uid, v]) => ({
          userId: uid,
          amount: parseFloat(v.value) || 0,
        }));
      } else if (splitType === 'percentage') {
        body.splitDetails = checked.map(([uid, v]) => ({
          userId: uid,
          percentage: parseFloat(v.value) || 0,
        }));
      } else if (splitType === 'share') {
        body.splitDetails = checked.map(([uid, v]) => ({
          userId: uid,
          shareValue: parseFloat(v.value) || 1,
        }));
      }

      await api.createExpense(body);
      onCreated();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-card" style={{ maxWidth: 520 }}>
        <h2 className="modal-title">Add Expense</h2>
        {error && <div className="alert alert-error" style={{ marginBottom: 12 }}><span>⚠</span> {error}</div>}
        <form className="modal-form" onSubmit={handleSubmit}>
          <div className="input-group">
            <label>Description *</label>
            <input className="input-field" value={desc} onChange={e => setDesc(e.target.value)} placeholder="What was this for?" autoFocus />
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <div className="input-group" style={{ flex: 1 }}>
              <label>Amount (₹) *</label>
              <input className="input-field" type="number" step="0.01" min="0" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" />
            </div>
            <div className="input-group" style={{ flex: 1 }}>
              <label>Date *</label>
              <input className="input-field" type="date" value={date} onChange={e => setDate(e.target.value)} />
            </div>
          </div>
          <div className="input-group">
            <label>Paid by</label>
            <select className="input-field" value={paidById} onChange={e => setPaidById(e.target.value)}>
              {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>

          <div className="split-config">
            <label style={{ fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--color-text-secondary)' }}>Split Type</label>
            <div className="split-type-selector">
              {['equal', 'unequal', 'percentage', 'share'].map(t => (
                <button key={t} type="button" className={`split-type-btn ${splitType === t ? 'active' : ''}`} onClick={() => setSplitType(t)}>
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>

            <label style={{ fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--color-text-secondary)' }}>Participants</label>
            <div className="participants-list">
              {members.map(m => (
                <div key={m.id} className="participant-row">
                  <label>
                    <input type="checkbox" checked={participants[m.id]?.checked || false} onChange={() => toggleParticipant(m.id)} />
                    {m.name}
                  </label>
                  {splitType !== 'equal' && participants[m.id]?.checked && (
                    <input
                      className="input-field participant-amount-input"
                      type="number"
                      step="0.01"
                      placeholder={splitType === 'percentage' ? '%' : splitType === 'share' ? 'shares' : '₹'}
                      value={participants[m.id]?.value || ''}
                      onChange={e => setParticipantValue(m.id, e.target.value)}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="input-group">
            <label>Notes (optional)</label>
            <textarea className="input-field" rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Any notes..." style={{ resize: 'vertical' }} />
          </div>

          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? 'Creating…' : 'Add Expense'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ── Settlement Modal ── */
function SettleModal({ groupId, from, to, amount, onClose, onSettled }) {
  const [settleAmount, setSettleAmount] = useState(amount?.toString() || '');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!settleAmount) { setError('Amount is required'); return; }
    setSubmitting(true);
    setError('');
    try {
      await api.createSettlement({
        groupId,
        paidById: from.id,
        paidToId: to.id,
        amount: parseFloat(settleAmount),
        date,
        notes: notes.trim() || undefined,
      });
      onSettled();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-card" style={{ maxWidth: 420 }}>
        <h2 className="modal-title">Record Settlement</h2>
        {error && <div className="alert alert-error" style={{ marginBottom: 12 }}><span>⚠</span> {error}</div>}
        <form className="modal-form" onSubmit={handleSubmit}>
          <div style={{ textAlign: 'center', padding: '8px 0', fontSize: 'var(--text-base)', color: 'var(--color-text-secondary)' }}>
            <strong style={{ color: 'var(--color-text-primary)' }}>{from.name}</strong>
            {' '}<span style={{ color: 'var(--color-accent-emerald)' }}>pays</span>{' '}
            <strong style={{ color: 'var(--color-text-primary)' }}>{to.name}</strong>
          </div>
          <div className="input-group">
            <label>Amount (₹)</label>
            <input className="input-field" type="number" step="0.01" value={settleAmount} onChange={e => setSettleAmount(e.target.value)} autoFocus />
          </div>
          <div className="input-group">
            <label>Date</label>
            <input className="input-field" type="date" value={date} onChange={e => setDate(e.target.value)} />
          </div>
          <div className="input-group">
            <label>Notes (optional)</label>
            <input className="input-field" value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g., UPI transfer" />
          </div>
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? 'Recording…' : 'Record Settlement'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ── Add Member Modal ── */
function AddMemberModal({ groupId, existingMembers, onClose, onAdded }) {
  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState('');
  const [selectedUser, setSelectedUser] = useState(null);
  const [joinedAt, setJoinedAt] = useState(new Date().toISOString().slice(0, 10));
  const [isNewUser, setIsNewUser] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function fetchUsers() {
      try {
        const data = await api.getUsers();
        const existingIds = new Set(existingMembers.map(m => m.id));
        const filtered = (data.users || []).filter(u => !existingIds.has(u.id));
        setUsers(filtered);
      } catch (err) {
        setError('Failed to load users: ' + err.message);
      } finally {
        setLoadingUsers(false);
      }
    }
    fetchUsers();
  }, [existingMembers]);

  const filteredUsers = users.filter(u =>
    u.name.toLowerCase().includes(search.toLowerCase()) ||
    u.email.toLowerCase().includes(search.toLowerCase())
  );

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (isNewUser) {
      if (!newName.trim()) {
        setError('Name is required');
        return;
      }
      setSubmitting(true);
      try {
        const newUserData = await api.createUser({
          name: newName.trim(),
          email: newEmail.trim() || undefined,
        });
        await api.addMember(groupId, {
          userId: newUserData.user.id,
          joinedAt,
        });
        onAdded();
      } catch (err) {
        setError(err.message);
      } finally {
        setSubmitting(false);
      }
    } else {
      if (!selectedUser) {
        setError('Please select a user to add');
        return;
      }
      setSubmitting(true);
      try {
        await api.addMember(groupId, {
          userId: selectedUser.id,
          joinedAt,
        });
        onAdded();
      } catch (err) {
        setError(err.message);
      } finally {
        setSubmitting(false);
      }
    }
  };

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-card" style={{ maxWidth: 450 }}>
        <h2 className="modal-title">Add Member</h2>
        {error && <div className="alert alert-error" style={{ marginBottom: 12 }}><span>⚠</span> {error}</div>}
        
        <div className="tab-toggle-container" style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <button
            type="button"
            className={`btn btn-sm ${!isNewUser ? 'btn-primary' : 'btn-ghost'}`}
            style={{ flex: 1 }}
            onClick={() => { setIsNewUser(false); setError(''); }}
          >
            Select Existing
          </button>
          <button
            type="button"
            className={`btn btn-sm ${isNewUser ? 'btn-primary' : 'btn-ghost'}`}
            style={{ flex: 1 }}
            onClick={() => { setIsNewUser(true); setError(''); }}
          >
            Create New User
          </button>
        </div>

        <form className="modal-form" onSubmit={handleSubmit}>
          {!isNewUser ? (
            <div className="input-group">
              <label>Select User</label>
              {loadingUsers ? (
                <div className="skeleton skeleton-line" style={{ height: 40, borderRadius: 6 }} />
              ) : (
                <>
                  <input
                    className="input-field"
                    style={{ marginBottom: 8 }}
                    value={search}
                    onChange={e => { setSearch(e.target.value); setSelectedUser(null); }}
                    placeholder="Type name or email to filter..."
                  />
                  <div className="user-dropdown-list">
                    {filteredUsers.length === 0 ? (
                      <div className="dropdown-item empty">No matching users found</div>
                    ) : (
                      filteredUsers.map(u => (
                        <div
                          key={u.id}
                          className={`dropdown-item ${selectedUser?.id === u.id ? 'selected' : ''}`}
                          onClick={() => { setSelectedUser(u); setSearch(u.name); }}
                        >
                          <div style={{ fontWeight: 500 }}>{u.name}</div>
                          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>{u.email}</div>
                        </div>
                      ))
                    )}
                  </div>
                </>
              )}
            </div>
          ) : (
            <>
              <div className="input-group">
                <label>Name *</label>
                <input
                  className="input-field"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder="e.g., John Doe"
                  required
                />
              </div>
              <div className="input-group">
                <label>Email (optional)</label>
                <input
                  className="input-field"
                  type="email"
                  value={newEmail}
                  onChange={e => setNewEmail(e.target.value)}
                  placeholder="e.g., john@example.com"
                />
              </div>
            </>
          )}

          <div className="input-group">
            <label>Join Date</label>
            <input
              className="input-field"
              type="date"
              value={joinedAt}
              onChange={e => setJoinedAt(e.target.value)}
              required
            />
          </div>

          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? 'Adding…' : 'Add Member'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ── Set Left Date Modal ── */
function SetLeftDateModal({ groupId, membership, onClose, onSaved }) {
  const [leftAt, setLeftAt] = useState(new Date().toISOString().slice(0, 10));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!leftAt) { setError('Left date is required'); return; }
    
    const joined = new Date(membership.joinedAt);
    const left = new Date(leftAt);
    if (left < joined) {
      setError(`Left date cannot be before join date (${joined.toLocaleDateString()})`);
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      await api.updateMember(groupId, membership.userId, { leftAt });
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-card" style={{ maxWidth: 400 }}>
        <h2 className="modal-title">Set Left Date</h2>
        {error && <div className="alert alert-error" style={{ marginBottom: 12 }}><span>⚠</span> {error}</div>}
        
        <div style={{ marginBottom: 16, fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
          Set the date when <strong style={{ color: 'var(--color-text-primary)' }}>{membership.user?.name}</strong> left the group.
          They will be excluded from any new expenses dated after this date.
        </div>

        <form className="modal-form" onSubmit={handleSubmit}>
          <div className="input-group">
            <label>Departure Date</label>
            <input
              className="input-field"
              type="date"
              value={leftAt}
              onChange={e => setLeftAt(e.target.value)}
              required
            />
          </div>

          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-danger" disabled={submitting}>
              {submitting ? 'Saving…' : 'Set Left Date'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
