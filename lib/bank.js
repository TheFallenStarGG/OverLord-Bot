// Pocket vs bank balances, fees, withdraw locks, weekly upkeep.
// Rob/gambling use pocket only (user.coins). Bank is user.bank.
const { getUser, peekUser, markDirty, fmt } = require('./economy');

const DEPOSIT_FEE = 0.01; // 1%
const FREE_WITHDRAW_DAILY = 750;
const LOCK_MS = 3 * 60 * 60 * 1000; // 3h for amounts above free daily
const UPKEEP_RATE = 0.01; // 1% of bank per week
const UPKEEP_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_BANK_ACTION = 10;

function ensureBank(u) {
  u.bank = Math.max(0, Math.floor(Number(u.bank) || 0));
  u.bankWithdrawnToday = Math.max(0, Math.floor(Number(u.bankWithdrawnToday) || 0));
  u.bankWithdrawDay = u.bankWithdrawDay || null;
  u.bankUnlockAt = Math.max(0, Number(u.bankUnlockAt) || 0);
  u.bankPending = Math.max(0, Math.floor(Number(u.bankPending) || 0));
  u.lastBankUpkeep = Math.max(0, Number(u.lastBankUpkeep) || 0);
  return u;
}

function dayKey() {
  return new Date().toISOString().slice(0, 10);
}

function resetDailyIfNeeded(u) {
  ensureBank(u);
  const d = dayKey();
  if (u.bankWithdrawDay !== d) {
    u.bankWithdrawDay = d;
    u.bankWithdrawnToday = 0;
  }
}

function pocket(id) {
  return Math.max(0, Math.floor(peekUser(id).coins || 0));
}

function bankOf(id) {
  return ensureBank(peekUser(id)).bank;
}

function totalWealth(id) {
  return pocket(id) + bankOf(id);
}

/** Apply pending unlock if timer elapsed. */
function settleUnlock(id) {
  const u = ensureBank(getUser(id));
  if (u.bankPending > 0 && u.bankUnlockAt && Date.now() >= u.bankUnlockAt) {
    const amt = u.bankPending;
    u.bankPending = 0;
    u.bankUnlockAt = 0;
    u.coins += amt;
    markDirty();
    return amt;
  }
  return 0;
}

function status(id) {
  settleUnlock(id);
  const u = ensureBank(peekUser(id));
  resetDailyIfNeeded(getUser(id));
  const live = ensureBank(getUser(id));
  return {
    pocket: live.coins,
    bank: live.bank,
    pending: live.bankPending,
    unlockAt: live.bankUnlockAt,
    withdrawnToday: live.bankWithdrawnToday,
    freeLeft: Math.max(0, FREE_WITHDRAW_DAILY - live.bankWithdrawnToday),
  };
}

function deposit(id, amount) {
  settleUnlock(id);
  const u = ensureBank(getUser(id));
  amount = Math.floor(Number(amount));
  if (!Number.isFinite(amount) || amount < MIN_BANK_ACTION) {
    return { error: `Deposit at least **${fmt(MIN_BANK_ACTION)}**.` };
  }
  if (u.coins < amount) {
    return { error: `You only have **${fmt(u.coins)}** in your pocket.` };
  }
  const fee = Math.max(0, Math.floor(amount * DEPOSIT_FEE));
  const net = amount - fee;
  if (net < 1) return { error: 'Amount too small after the 1% deposit fee.' };
  u.coins -= amount;
  u.bank += net;
  markDirty();
  try {
    if (require('./economyMode').isScarce() && fee > 0) {
      require('./treasury').depositReserve(fee);
    }
  } catch (_) {}
  return { ok: true, deposited: net, fee, pocket: u.coins, bank: u.bank };
}

function withdraw(id, amount) {
  settleUnlock(id);
  const u = ensureBank(getUser(id));
  resetDailyIfNeeded(u);
  amount = Math.floor(Number(amount));
  if (!Number.isFinite(amount) || amount < MIN_BANK_ACTION) {
    return { error: `Withdraw at least **${fmt(MIN_BANK_ACTION)}**.` };
  }
  if (u.bankPending > 0) {
    return {
      error:
        `You already have **${fmt(u.bankPending)}** unlocking <t:${Math.ceil(u.bankUnlockAt / 1000)}:R>. ` +
        `Wait for that before starting another large withdraw.`,
    };
  }
  if (u.bank < amount) {
    return { error: `You only have **${fmt(u.bank)}** in the bank.` };
  }

  const freeLeft = Math.max(0, FREE_WITHDRAW_DAILY - u.bankWithdrawnToday);
  if (amount <= freeLeft) {
    u.bank -= amount;
    u.coins += amount;
    u.bankWithdrawnToday += amount;
    markDirty();
    return { ok: true, instant: true, amount, pocket: u.coins, bank: u.bank, freeLeft: FREE_WITHDRAW_DAILY - u.bankWithdrawnToday };
  }

  // Large withdraw: lock 3 hours, then auto-credits pocket
  u.bank -= amount;
  u.bankPending = amount;
  u.bankUnlockAt = Date.now() + LOCK_MS;
  u.bankWithdrawnToday += amount;
  markDirty();
  return {
    ok: true,
    instant: false,
    amount,
    unlockAt: u.bankUnlockAt,
    pocket: u.coins,
    bank: u.bank,
  };
}

/** Steal from bank balance (heist). Returns amount moved to thief. */
function stealFromBank(victimId, thiefId, amount) {
  amount = Math.floor(Number(amount) || 0);
  if (amount < 1) return 0;
  const v = ensureBank(getUser(victimId));
  const take = Math.min(amount, v.bank);
  if (take < 1) return 0;
  v.bank -= take;
  const t = getUser(thiefId);
  t.coins += take;
  markDirty();
  return take;
}

function applyUpkeep(id) {
  const u = ensureBank(getUser(id));
  const now = Date.now();
  if (!u.lastBankUpkeep) {
    u.lastBankUpkeep = now;
    markDirty();
    return 0;
  }
  if (now - u.lastBankUpkeep < UPKEEP_INTERVAL_MS) return 0;
  u.lastBankUpkeep = now;
  if (u.bank < 100) {
    markDirty();
    return 0;
  }
  const fee = Math.max(1, Math.floor(u.bank * UPKEEP_RATE));
  const taken = Math.min(u.bank, fee);
  u.bank -= taken;
  markDirty();
  try {
    if (require('./economyMode').isScarce() && taken > 0) {
      require('./treasury').depositReserve(taken);
    }
  } catch (_) {}
  return taken;
}

/** Run upkeep for many users (tick). */
function tickUpkeep(max = 200) {
  try {
    const { top } = require('./economy');
    let n = 0;
    for (const e of top('coins', max)) {
      if (applyUpkeep(e.id) > 0) n++;
    }
    // also people with bank but low coins - approximate via same list is weak;
    // applyUpkeep on getUser when they !!bank is enough backup
    return n;
  } catch (_) {
    return 0;
  }
}

module.exports = {
  DEPOSIT_FEE,
  FREE_WITHDRAW_DAILY,
  LOCK_MS,
  UPKEEP_RATE,
  pocket,
  bankOf,
  totalWealth,
  status,
  deposit,
  withdraw,
  stealFromBank,
  settleUnlock,
  applyUpkeep,
  tickUpkeep,
  ensureBank,
};
