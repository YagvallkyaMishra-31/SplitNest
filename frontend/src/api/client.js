const API_BASE = 'http://localhost:3001/api';

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || err.message || 'Request failed');
  }
  return res.json();
}

export const api = {
  // Auth
  register: (data) => request('/auth/register', { method: 'POST', body: JSON.stringify(data) }),
  login: (data) => request('/auth/login', { method: 'POST', body: JSON.stringify(data) }),
  logout: () => request('/auth/logout', { method: 'POST' }),
  getMe: () => request('/auth/me'),

  // Groups
  getGroups: () => request('/groups'),
  getGroup: (id) => request(`/groups/${id}`),
  createGroup: (data) => request('/groups', { method: 'POST', body: JSON.stringify(data) }),
  updateGroup: (id, data) => request(`/groups/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  addMember: (groupId, data) => request(`/groups/${groupId}/members`, { method: 'POST', body: JSON.stringify(data) }),
  updateMember: (groupId, userId, data) => request(`/groups/${groupId}/members/${userId}`, { method: 'PUT', body: JSON.stringify(data) }),
  getGroupBalances: (groupId) => request(`/groups/${groupId}/balances`),
  getUserBalance: (groupId, userId) => request(`/groups/${groupId}/balances/${userId}`),

  // Expenses
  getExpenses: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/expenses${qs ? `?${qs}` : ''}`);
  },
  getExpense: (id) => request(`/expenses/${id}`),
  createExpense: (data) => request('/expenses', { method: 'POST', body: JSON.stringify(data) }),
  updateExpense: (id, data) => request(`/expenses/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteExpense: (id) => request(`/expenses/${id}`, { method: 'DELETE' }),

  // Settlements
  getSettlements: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/settlements${qs ? `?${qs}` : ''}`);
  },
  createSettlement: (data) => request('/settlements', { method: 'POST', body: JSON.stringify(data) }),

  // Users
  getUsers: () => request('/users'),
  createUser: (data) => request('/users', { method: 'POST', body: JSON.stringify(data) }),

  // Import
  uploadCSV: (csvText, filename) => request('/import/upload', { method: 'POST', body: JSON.stringify({ csvText, filename }) }),
  getImportSessions: () => request('/import'),
  getImportSession: (id) => request(`/import/${id}`),
  approveImport: (id) => request(`/import/${id}/approve`, { method: 'POST' }),
  rejectImport: (id) => request(`/import/${id}/reject`, { method: 'POST' }),
};

