// Each day you get 3 random quests from the daily list, and each week 2 from the weekly list.
// type = what counts toward it: messages, work, fish, mine, win, daily
const DAILY_QUESTS = [
  { id: 'd_msg', type: 'messages', goal: 20, text: 'Send 20 messages', coins: 80 },
  { id: 'd_work', type: 'work', goal: 8, text: 'Work 8 times', coins: 100 },
  { id: 'd_fish', type: 'fish', goal: 3, text: 'Go fishing 3 times', coins: 90 },
  { id: 'd_mine', type: 'mine', goal: 3, text: 'Go mining 3 times', coins: 90 },
  { id: 'd_win', type: 'win', goal: 2, text: 'Win 2 games', coins: 150 },
  { id: 'd_daily', type: 'daily', goal: 1, text: 'Claim your `!!daily`', coins: 40 },
];

const WEEKLY_QUESTS = [
  { id: 'w_work', type: 'work', goal: 100, text: 'Work 100 times', coins: 800, item: 'lootbox' },
  { id: 'w_win', type: 'win', goal: 10, text: 'Win 10 games', coins: 900, item: 'lootbox' },
  { id: 'w_fish', type: 'fish', goal: 25, text: 'Go fishing 25 times', coins: 700, item: 'lootbox' },
  { id: 'w_mine', type: 'mine', goal: 25, text: 'Go mining 25 times', coins: 700, item: 'lootbox' },
  { id: 'w_msg', type: 'messages', goal: 150, text: 'Send 150 messages', coins: 600, item: 'lootbox' },
];

module.exports = { DAILY_QUESTS, WEEKLY_QUESTS };
