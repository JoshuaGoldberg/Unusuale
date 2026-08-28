'use strict';

var STORAGE_PREFIX = 'unusuale:v1:';

// The continent map picker loads assets/continents.svg on first use and
// caches the parsed template -- see loadContinentMap() below.
var CONTINENT_MAP_URL = 'assets/continents.svg';
var continentMapPromise = null;

function loadContinentMap() {
  if (!continentMapPromise) {
    continentMapPromise = fetch(CONTINENT_MAP_URL)
      .then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.text();
      })
      .then(function (text) {
        return new DOMParser().parseFromString(text, 'image/svg+xml').documentElement;
      });
  }
  return continentMapPromise;
}

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

var QUESTION_TYPES = {
  multiple: {
    render: function (question, mount, onInput) {
      var name = 'choice-' + question.id;
      var list = document.createElement('ul');
      list.className = 'choices';

      question.choices.forEach(function (choice, index) {
        var item = document.createElement('li');
        var label = document.createElement('label');
        label.className = 'choice';

        var input = document.createElement('input');
        input.type = 'radio';
        input.name = name;
        input.value = String(index);
        input.addEventListener('change', onInput);

        var text = document.createElement('span');
        text.textContent = choice;

        label.appendChild(input);
        label.appendChild(text);
        item.appendChild(label);
        list.appendChild(item);
      });

      mount.appendChild(list);

      return {
        getResponse: function () {
          var picked = mount.querySelector('input[name="' + name + '"]:checked');
          return picked ? Number(picked.value) : null;
        }
      };
    },

    check: function (question, response) {
      return {
        score: response === question.answerIndex ? 100 : 0,
        answerText: question.choices[question.answerIndex]
      };
    },

    maxScore: 100
  },

  number: {
    render: function (question, mount, onInput) {
      var wrap = document.createElement('p');
      wrap.className = 'number-input';

      var input = document.createElement('input');
      input.type = 'number';
      input.inputMode = 'numeric';
      input.setAttribute('aria-label', question.prompt);
      input.addEventListener('input', onInput);
      wrap.appendChild(input);

      if (question.unit) {
        var unit = document.createElement('span');
        unit.className = 'unit';
        unit.textContent = question.unit;
        wrap.appendChild(unit);
      }

      mount.appendChild(wrap);

      return {
        getResponse: function () {
          if (input.value.trim() === '') return null;
          var value = Number(input.value);
          return Number.isFinite(value) ? value : null;
        }
      };
    },

    check: function (question, response) {
      var answerText = question.unit
        ? question.answer + ' ' + question.unit
        : String(question.answer);

      var off = Math.abs(response - question.answer);
      if (off === 0) return { score: 500, answerText: answerText };

      var answerMagnitude = Math.abs(question.answer) || 1;
      var guessMagnitude = Math.abs(response) || 1;
      var percentOff = off / guessMagnitude;
      var sigma = ((question.tolerance || answerMagnitude * 0.1) / answerMagnitude) * 2;
      var score = Math.round(500 * Math.exp(-0.5 * Math.pow(percentOff / sigma, 2)));

      return { score: score, answerText: answerText, note: 'Off by ' + off + '.' };
    },

    maxScore: 500
  },

  continent: {
    render: function (question, mount, onInput) {
      var wrap = document.createElement('div');
      wrap.className = 'continent-map-wrap';

      var caption = document.createElement('p');
      caption.className = 'continent-caption';
      caption.textContent = 'Loading map…';
      wrap.appendChild(caption);
      mount.appendChild(wrap);

      var selected = null;

      loadContinentMap().then(function (template) {
        var svg = template.cloneNode(true);
        svg.removeAttribute('width');
        svg.removeAttribute('height');
        svg.classList.add('continent-map');
        svg.setAttribute('role', 'group');
        svg.setAttribute('aria-label', 'World map, pick a continent');

        svg.querySelectorAll('.continent-shape').forEach(function (shape) {
          var name = shape.getAttribute('data-continent');

          var select = function () {
            selected = name;
            svg.querySelectorAll('.continent-shape').forEach(function (node) {
              node.classList.toggle('selected', node === shape);
            });
            caption.textContent = 'Selected: ' + name;
            onInput();
          };

          shape.addEventListener('click', select);
          shape.addEventListener('keydown', function (event) {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              // Selecting a continent already responds to Enter on its own;
              // stop it here so the page-wide Enter-to-submit handler below
              // doesn't also fire and submit before the player can review
              // their pick.
              event.stopPropagation();
              select();
            }
          });
        });

        wrap.insertBefore(svg, caption);
        caption.textContent = 'Click a continent.';
      }, function () {
        caption.textContent = 'The map failed to load.';
      });

      return {
        getResponse: function () {
          return selected;
        }
      };
    },

    check: function (question, response) {
      return {
        score: response === question.answer ? 250 : 0,
        answerText: question.answer
      };
    },

    reveal: function (question, response, card) {
      var correct = card.querySelector('.continent-shape[data-continent="' + question.answer + '"]');
      if (correct) correct.classList.add('correct');
    },

    maxScore: 250
  },

  text: {
    render: function (question, mount, onInput) {
      var wrap = document.createElement('p');
      wrap.className = 'text-input';

      var input = document.createElement('input');
      input.type = 'text';
      input.autocomplete = 'off';
      input.autocapitalize = 'off';
      input.spellcheck = false;
      input.setAttribute('aria-label', question.prompt);
      input.addEventListener('input', onInput);
      wrap.appendChild(input);

      mount.appendChild(wrap);

      return {
        getResponse: function () {
          var value = input.value.trim();
          return value === '' ? null : value;
        }
      };
    },

    check: function (question, response) {
      var guess = normalizeAnswerText(response);
      var candidates = [question.answer].concat(question.answers || []);

      var matched = candidates.some(function (candidate) {
        return isCloseEnough(guess, normalizeAnswerText(candidate));
      });

      return {
        score: matched ? 500 : 0,
        answerText: question.answer
      };
    },

    maxScore: 500
  }
};

/* ---------- helpers ---------- */

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

function element(tag, className, text) {
  var node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/* ---------- rendering ---------- */

var mount = document.getElementById('game');
var scoreTracker = document.getElementById('score-tracker');
var scoreValue = document.getElementById('score-value');
var state = { date: null, puzzle: null, index: 0, responses: [], hintsUsed: [] };
var displayedScore = 0;
var scoreAnimFrame = null;

function setScoreDisplay(value) {
  displayedScore = value;
  if (scoreAnimFrame) cancelAnimationFrame(scoreAnimFrame);
  if (scoreValue) scoreValue.textContent = value;
}

function animateScoreTo(target) {
  if (!scoreValue) { displayedScore = target; return; }
  if (scoreAnimFrame) cancelAnimationFrame(scoreAnimFrame);

  var start = displayedScore;
  var delta = target - start;
  if (delta === 0) return;

  if (scoreTracker) {
    scoreTracker.classList.remove('pulse');
    void scoreTracker.offsetWidth; // restart the animation
    scoreTracker.classList.add('pulse');
  }

  var duration = 600;
  var startTime = null;

  function step(timestamp) {
    if (startTime === null) startTime = timestamp;
    var progress = Math.min((timestamp - startTime) / duration, 1);
    var eased = 1 - Math.pow(1 - progress, 3);
    scoreValue.textContent = Math.round(start + delta * eased);
    if (progress < 1) {
      scoreAnimFrame = requestAnimationFrame(step);
    } else {
      displayedScore = target;
      scoreAnimFrame = null;
    }
  }
  scoreAnimFrame = requestAnimationFrame(step);
}

function scoreOf(question, response, hintUsed) {
  var handler = QUESTION_TYPES[question.type];
  var maxScore = handler ? handler.maxScore : 0;
  if (!handler || response === null || response === undefined) {
    return { score: 0, maxScore: maxScore, answerText: '', outcome: 'wrong' };
  }
  var result = handler.check(question, response);
  result.maxScore = maxScore;
  // Outcome (right/partial/wrong) reflects whether the answer itself was
  // correct, computed before the hint penalty -- getting it right after
  // using a hint is still "Correct.", just worth half the points.
  result.outcome = !maxScore || result.score <= 0 ? 'wrong'
    : result.score >= maxScore ? 'right' : 'partial';
  if (hintUsed) {
    result.score = Math.round(result.score * 0.5);
  }
  return result;
}

function classify(result) {
  return result.outcome;
}

function totalScore() {
  return state.puzzle.questions.reduce(function (sum, question, i) {
    return sum + scoreOf(question, state.responses[i], state.hintsUsed[i]).score;
  }, 0);
}

function maxPossibleScore() {
  return state.puzzle.questions.reduce(function (sum, question) {
    var handler = QUESTION_TYPES[question.type];
    return sum + (handler ? handler.maxScore : 0);
  }, 0);
}

function renderQuestion() {
  var question = state.puzzle.questions[state.index];
  var handler = QUESTION_TYPES[question.type];

  mount.textContent = '';

  var total = state.puzzle.questions.length;
  mount.appendChild(element('p', 'progress', 'Round ' + (state.index + 1) + ' of ' + total));

  var card = element('div', 'question');
  card.appendChild(element('h2', 'prompt', question.prompt));

  if (!handler) {
    card.appendChild(element('p', 'feedback wrong',
      'This round uses an unknown question type ("' + question.type + '") and has been skipped.'));
    mount.appendChild(card);
    mount.appendChild(nextButton('Skip'));
    return;
  }

  var widgetHost = element('div', 'widget');
  card.appendChild(widgetHost);
  mount.appendChild(card);

  var submit = element('button', 'button primary-action', 'Submit');
  submit.type = 'button';
  submit.disabled = true;
  mount.appendChild(submit);

  var hintUsed = false;

  if (question.hint) {
    var hintButton = element('button', 'button hint-button', 'Show hint (half credit)');
    hintButton.type = 'button';
    hintButton.addEventListener('click', function () {
      hintUsed = true;
      hintButton.disabled = true;
      card.appendChild(element('p', 'hint-reveal', question.hint));
    });
    mount.appendChild(hintButton);
  }

  var widget = handler.render(question, widgetHost, function () {
    submit.disabled = widget.getResponse() === null;
  });

  submit.addEventListener('click', function () {
    var response = widget.getResponse();
    if (response === null) return;
    state.responses[state.index] = response;
    state.hintsUsed[state.index] = hintUsed;
    save(state.date, state.responses, state.hintsUsed);
    revealAnswer(question, response, card, submit, hintUsed);
  });
}

function revealAnswer(question, response, card, submit, hintUsed) {
  submit.remove();

  card.classList.add('locked');
  card.querySelectorAll('input').forEach(function (input) { input.disabled = true; });
  card.querySelectorAll('.continent-shape').forEach(function (shape) {
    shape.setAttribute('tabindex', '-1');
  });
  mount.querySelectorAll('.hint-button').forEach(function (button) { button.remove(); });

  var result = scoreOf(question, response, hintUsed);
  var outcome = classify(result);
  var box = element('div', 'feedback ' + outcome);

  var handler = QUESTION_TYPES[question.type];
  if (handler && handler.reveal) handler.reveal(question, response, card);

  var verdict = outcome === 'right' ? 'Correct.' : outcome === 'partial' ? 'Almost.' : 'Not quite.';
  box.appendChild(element('p', 'verdict', verdict + (result.note ? ' ' + result.note : '')));
  box.appendChild(element('p', 'points', '+' + result.score + ' points' + (hintUsed ? ' (half credit, hint used)' : '')));

  animateScoreTo(totalScore());

  if (outcome !== 'right' && result.answerText) {
    box.appendChild(element('p', null, 'Answer: ' + result.answerText));
  }

  if (question.explanation) {
    box.appendChild(element('p', 'explanation', question.explanation));
  }

  if (question.article && question.article.url) {
    var source = element('p', 'source');
    var link = element('a', null, question.article.title || 'Read the article');
    link.href = question.article.url;
    link.target = '_blank';
    link.rel = 'noopener';
    source.appendChild(document.createTextNode('From Wikipedia: '));
    source.appendChild(link);
    box.appendChild(source);
  }

  card.appendChild(box);

  var last = state.index === state.puzzle.questions.length - 1;
  mount.appendChild(nextButton(last ? 'See results' : 'Next round'));
}

function nextButton(label) {
  var button = element('button', 'button primary-action', label);
  button.type = 'button';
  button.addEventListener('click', function () {
    state.index += 1;
    if (state.index >= state.puzzle.questions.length) {
      renderResults();
    } else {
      renderQuestion();
    }
  });
  return button;
}

function shareText() {
  var grid = state.puzzle.questions.map(function (question, i) {
    var result = scoreOf(question, state.responses[i], state.hintsUsed[i]);
    var outcome = classify(result);
    return outcome === 'right' ? '🟩' : outcome === 'partial' ? '🟨' : '⬜';
  }).join('');

  return 'Unusuale ' + state.date + '\n' + grid + '  ' +
    totalScore() + '/' + maxPossibleScore() + ' pts';
}

function renderResults() {
  mount.textContent = '';

  mount.appendChild(element('h2', null, 'Results'));
  mount.appendChild(element('p', 'score',
    'You scored ' + totalScore() + ' out of ' + maxPossibleScore() + ' points.'));

  var summary = element('ol', 'summary');
  state.puzzle.questions.forEach(function (question, i) {
    var result = scoreOf(question, state.responses[i], state.hintsUsed[i]);
    var item = element('li', classify(result));
    item.appendChild(element('span', 'summary-prompt', question.prompt));
    if (result.answerText) {
      item.appendChild(element('span', 'summary-answer', result.answerText));
    }
    summary.appendChild(item);
  });
  mount.appendChild(summary);

  var share = element('pre', 'share', shareText());
  mount.appendChild(share);

  var copy = element('button', 'button', 'Copy result');
  copy.type = 'button';
  copy.addEventListener('click', function () {
    var done = function () { copy.textContent = 'Copied'; };
    if (navigator.clipboard) {
      navigator.clipboard.writeText(shareText()).then(done, function () {
        copy.textContent = 'Copy failed';
      });
    } else {
      copy.textContent = 'Copy failed';
    }
  });
  mount.appendChild(copy);

  var footer = element('p', 'results-footer');
  var home = element('a', null, 'Back to the front page');
  home.href = 'index.html';
  footer.appendChild(home);
  mount.appendChild(footer);
}

function renderError(message) {
  if (scoreTracker) scoreTracker.style.display = 'none';
  mount.textContent = '';
  mount.appendChild(element('p', null, message));
  var back = element('p', null);
  var link = element('a', null, 'Back to the front page');
  link.href = 'index.html';
  back.appendChild(link);
  mount.appendChild(back);
}

// Enter triggers whichever primary action is currently active -- Submit
// while answering, Next round/See results/Skip once revealed. Continent
// shapes handle their own Enter (see stopPropagation above) so this only
// ever sees the keystroke when nothing on the map absorbed it first.
document.addEventListener('keydown', function (event) {
  if (event.key !== 'Enter' || event.repeat) return;
  var action = mount.querySelector('.primary-action:not(:disabled)');
  if (!action) return;
  event.preventDefault();
  action.click();
});

/* ---------- boot ---------- */

function start() {
  var date = requestedDate();
  state.date = date;
  document.getElementById('puzzle-date').textContent = formatDate(date);

  // `cache: 'no-store'` only stops the browser's own cache; GitHub Pages'
  // CDN can still serve a stale copy of the same URL for a few minutes
  // after a push. A cache-busting query param makes every load a distinct
  // URL, so it can't hit any cached copy at all, browser or CDN.
  fetch('puzzles/' + date + '.json?t=' + Date.now(), { cache: 'no-store' })
    .then(function (response) {
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return response.json();
    })
    .then(function (puzzle) {
      state.puzzle = puzzle;
      if (puzzle.title) document.getElementById('puzzle-title').textContent = puzzle.title;

      // Responses are stored in round order, so their count is the resume point.
      var saved = loadSaved(date);
      if (saved && Array.isArray(saved.responses)) {
        state.responses = saved.responses.slice(0, puzzle.questions.length);
        state.hintsUsed = Array.isArray(saved.hintsUsed)
          ? saved.hintsUsed.slice(0, puzzle.questions.length)
          : [];
        state.index = state.responses.length;
      }

      setScoreDisplay(totalScore());

      if (state.index >= puzzle.questions.length) {
        renderResults();
      } else {
        renderQuestion();
      }
    })
    .catch(function () {
      renderError('There is no puzzle for ' + date + ' yet. Check back tomorrow.');
    });
}

start();
