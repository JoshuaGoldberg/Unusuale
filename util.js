'use strict';

/* ---------- answer matching ---------- */

function normalizeAnswerText(s) {
  return String(s).trim().toLowerCase().replace(/\s+/g, ' ');
}

// Iterative Levenshtein (edit) distance: how many single-character
// insertions/deletions/substitutions turn `a` into `b`.
function editDistance(a, b) {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  var prev = [];
  for (var j = 0; j <= b.length; j++) prev[j] = j;

  for (var i = 1; i <= a.length; i++) {
    var curr = [i];
    for (var k = 1; k <= b.length; k++) {
      var cost = a[i - 1] === b[k - 1] ? 0 : 1;
      curr[k] = Math.min(prev[k] + 1, curr[k - 1] + 1, prev[k - 1] + cost);
    }
    prev = curr;
  }
  return prev[b.length];
}

// A guess counts as correct if it's an exact match (after trimming/casing)
// or close enough to one of the accepted answers to be a plain misspelling
// rather than a different answer, allow zero slack for very short
// answers, where a single typo usually changes the word entirely.
function isCloseEnough(guess, target) {
  if (guess === target) return true;
  if (target.length <= 3) return false;
  var allowed = Math.max(1, Math.floor(target.length * 0.25));
  return editDistance(guess, target) <= allowed;
}

/* ---------- dates ---------- */

function todayISO() {
  var now = new Date();
  var pad = function (n) { return String(n).padStart(2, '0'); };
  return now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
}

function requestedDate() {
  var asked = new URLSearchParams(window.location.search).get('date');
  return /^\d{4}-\d{2}-\d{2}$/.test(asked || '') ? asked : todayISO();
}

function formatDate(iso) {
  var parts = iso.split('-').map(Number);
  var date = new Date(parts[0], parts[1] - 1, parts[2]);
  return date.toLocaleDateString(undefined, {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
}

/* ---------- saved progress ---------- */

var STORAGE_PREFIX = 'unusuale:v1:';

function loadSaved(date) {
  try {
    var raw = window.localStorage.getItem(STORAGE_PREFIX + date);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    return null;
  }
}

function save(date, responses, hintsUsed) {
  try {
    window.localStorage.setItem(STORAGE_PREFIX + date, JSON.stringify({ responses: responses, hintsUsed: hintsUsed }));
  } catch (err) {
    /* Private browsing, quota, etc. The game still plays; it just won't persist. */
  }
}

/* ---------- DOM ---------- */

function element(tag, className, text) {
  var node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
