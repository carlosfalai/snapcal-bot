// ASCII bars for in-message visualization. Monospace-friendly.

function progressBar(value, max, width = 18) {
  if (!isFinite(value) || !isFinite(max) || max <= 0) return '-'.repeat(width);
  const ratio = Math.max(0, Math.min(1, value / max));
  const filled = Math.round(ratio * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

// Tiny vertical-ish 7-day chart using 8 height steps.
//   days: array of 7 numbers (oldest→newest), goal: number for the goal line.
// Returns a multi-line monospace string.
const BLOCKS = [' ', '▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];

function weekChart(days, goal, label = 'kcal') {
  const max = Math.max(goal || 0, ...days, 1);
  const labels = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const lines = [];
  // single-line block bar (one column per day)
  const row = days.map(v => BLOCKS[Math.min(8, Math.round((v / max) * 8))]).join(' ');
  lines.push('     ' + labels.map(l => l[0]).join(' '));
  lines.push('day: ' + row);
  // numeric line
  const nums = days.map(v => String(v).padStart(4, ' ')).join(' ');
  lines.push('     ' + nums);
  if (goal) lines.push('goal: ' + goal + ' ' + label);
  return lines.join('\n');
}

module.exports = { progressBar, weekChart };
