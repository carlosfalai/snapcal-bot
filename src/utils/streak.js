// Compute current logging streak (days in a row with at least 1 meal logged).
// Today counts even if user hasn't logged yet (gives them grace).
const { query } = require('../db');

async function currentStreak(userId) {
  const r = await query(
    `SELECT DISTINCT DATE(captured_at) AS d
       FROM meals
      WHERE user_id = $1 AND deleted_at IS NULL
      ORDER BY d DESC
      LIMIT 60`,
    [userId]
  );
  if (r.rows.length === 0) return 0;
  const have = new Set(r.rows.map(row => row.d.toISOString().slice(0, 10)));
  let streak = 0;
  const cur = new Date();
  cur.setHours(0, 0, 0, 0);
  // If today not logged yet, allow grace (start counting from yesterday)
  if (!have.has(cur.toISOString().slice(0, 10))) {
    cur.setDate(cur.getDate() - 1);
  }
  while (have.has(cur.toISOString().slice(0, 10))) {
    streak++;
    cur.setDate(cur.getDate() - 1);
  }
  return streak;
}

module.exports = { currentStreak };
