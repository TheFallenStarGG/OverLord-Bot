// Realm treasury / reserve — used when economy mode is "scarce"
const { data, saveNow } = require('./world');

function ensure() {
  data.treasury ??= {
    reserve: 0,
    lastTaxAt: 0,
    lastStimulusAt: 0,
    totalTaxed: 0,
    totalWages: 0,
  };
  data.treasury.reserve = Math.max(0, Math.floor(Number(data.treasury.reserve) || 0));
  data.treasury.lastTaxAt = Number(data.treasury.lastTaxAt) || 0;
  data.treasury.totalTaxed = Math.max(0, Math.floor(Number(data.treasury.totalTaxed) || 0));
  data.treasury.totalWages = Math.max(0, Math.floor(Number(data.treasury.totalWages) || 0));
  return data.treasury;
}

function getReserve() {
  return ensure().reserve;
}

/** Add coins to the realm reserve (taxes, fees, sinks). */
function depositReserve(amount) {
  amount = Math.floor(Number(amount) || 0);
  if (amount <= 0) return 0;
  ensure().reserve += amount;
  saveNow();
  return amount;
}

/**
 * Take up to `amount` from the reserve to pay a player.
 * Returns how much was actually paid (may be less if reserve is low).
 */
function withdrawReserve(amount) {
  amount = Math.floor(Number(amount) || 0);
  if (amount <= 0) return 0;
  const t = ensure();
  const paid = Math.min(t.reserve, amount);
  t.reserve -= paid;
  if (paid > 0) {
    t.totalWages = (t.totalWages || 0) + paid;
    saveNow();
  }
  return paid;
}

/** One-time or admin seed (e.g. enabling scarce mode). */
function setReserve(amount) {
  ensure().reserve = Math.max(0, Math.floor(Number(amount) || 0));
  saveNow();
  return ensure().reserve;
}

function addReserve(amount) {
  return depositReserve(amount);
}

module.exports = {
  ensure,
  getReserve,
  depositReserve,
  withdrawReserve,
  setReserve,
  addReserve,
};
