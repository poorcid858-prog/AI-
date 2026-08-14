const store = require('./store');

function list() {
  return store.read('prompt_templates', []);
}

function listEnabled(role = 'all') {
  const all = list();
  return all
    .filter(t => t.enabled)
    .filter(t => t.role === 'all' || t.role === role)
    .sort((a, b) => (a.priority || 0) - (b.priority || 0));
}

function create(data) {
  const id = store.nextId('prompt_templates');
  const tpl = { id, ...data, createdAt: new Date().toISOString() };
  store.push('prompt_templates', tpl);
  return tpl;
}

function update(id, data) {
  const all = list();
  const idx = all.findIndex(t => t.id === id);
  if (idx === -1) return null;
  all[idx] = { ...all[idx], ...data, updatedAt: new Date().toISOString() };
  store.write('prompt_templates', all);
  return all[idx];
}

function remove(id) {
  const all = list();
  const idx = all.findIndex(t => t.id === id);
  if (idx === -1) return false;
  all.splice(idx, 1);
  store.write('prompt_templates', all);
  return true;
}

module.exports = { list, listEnabled, create, update, remove };
