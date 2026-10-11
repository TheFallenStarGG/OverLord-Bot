// Switches the website admin panel can flip: maintenance mode and commands turned off for every server.
// Kept in memory (it is checked on every command). lib/adminBridge.js loads and saves them.
const state = { maintenance: { on: false, message: '', since: 0 }, disabled: {} };

const shortName = (command) => String(command?.name ?? command).replace(/^!!/, '').toLowerCase();

function load(saved) {
  const m = saved?.maintenance ?? {};
  state.maintenance = { on: Boolean(m.on), message: String(m.message ?? '').slice(0, 200), since: Number(m.since) || 0 };
  state.disabled = {};
  for (const [name, info] of Object.entries(saved?.disabled ?? {})) if (info) state.disabled[name] = info;
}

function setMaintenance(on, message = '') {
  state.maintenance = { on: Boolean(on), message: on ? String(message).slice(0, 200) : '', since: on ? Date.now() : 0 };
}

function setCommandDisabled(name, off, by = '') {
  const key = shortName(name);
  if (off) state.disabled[key] = { at: Date.now(), by };
  else delete state.disabled[key];
}

// Returns { ok: true } or { ok: false, reply }
function check(command) {
  if (state.maintenance.on) {
    const note = state.maintenance.message;
    return { ok: false, reply: `🛠️ I'm under maintenance right now${note ? `: ${note}` : '.'} Please try again in a bit.` };
  }
  const name = shortName(command);
  if (state.disabled[name]) {
    return { ok: false, reply: `🚫 \`!!${name}\` is temporarily switched off for everyone. Please try again later.` };
  }
  return { ok: true };
}

const snapshot = () => JSON.parse(JSON.stringify(state));

module.exports = { load, setMaintenance, setCommandDisabled, check, snapshot };
