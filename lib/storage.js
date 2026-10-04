const fs = require('fs');
const path = require('path');

// Writes to a temp file first, then swaps it in, so a crash mid-save can't corrupt the data
function writeJson(file, data) {
  const tmp = file + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, file);
  } catch (err) {
    console.error(`Could not save ${path.basename(file)}:`, err);
  }
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

module.exports = { writeJson, readJson };
