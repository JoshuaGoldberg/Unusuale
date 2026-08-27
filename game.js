'use strict';

/*
 * Unusuale game engine.
 *
 * The engine knows nothing about individual puzzles. It loads
 * puzzles/<YYYY-MM-DD>.json and walks the `questions` array, handing each
 * question to the handler registered for its `type`.
 *
 * To add a round type, add one entry to QUESTION_TYPES:
 *
 *   render(question, mount, onInput) -> { getResponse }
 *       Build the input widget inside `mount`. Call onInput() whenever the
 *       player's input changes. getResponse() returns the player's answer, or
 *       null if they haven't answered yet (which keeps Submit disabled).
 *
 *   check(question, response) -> { score, answerText, note? }
 *       score is a point value from 0 up to the type's maxScore, so a type
 *       can award partial credit. answerText is the correct answer, shown
 *       in the reveal.
 *
 *   maxScore
 *       the number of points a perfect answer is worth for this type.
 *
 * Fields shared by every type -- id, type, prompt, article, explanation -- are
 * handled here, so a new type only implements its widget and its scoring.
 */

var STORAGE_PREFIX = 'unusuale:v1:';

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

      // Points fall off a bell curve keyed on how far off the guess was,
      // as a percentage of the correct answer. `tolerance` (if given, in
      // the question's own units) sets the curve's one-standard-deviation
      // width; a guess that's off by exactly `tolerance` scores ~303/500.
      var magnitude = Math.abs(question.answer) || 1;
      var percentOff = off / magnitude;
      var sigma = (question.tolerance || magnitude * 0.1) / magnitude;
      var score = Math.round(500 * Math.exp(-0.5 * Math.pow(percentOff / sigma, 2)));

      return { score: score, answerText: answerText, note: 'Off by ' + off + '.' };
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

function save(date, responses) {
  try {
    window.localStorage.setItem(STORAGE_PREFIX + date, JSON.stringify({ responses: responses }));
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
var state = { date: null, puzzle: null, index: 0, responses: [] };
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

function scoreOf(question, response) {
  var handler = QUESTION_TYPES[question.type];
  var maxScore = handler ? handler.maxScore : 0;
  if (!handler || response === null || response === undefined) {
    return { score: 0, maxScore: maxScore, answerText: '' };
  }
  var result = handler.check(question, response);
  result.maxScore = maxScore;
  return result;
}

function classify(result) {
  if (!result.maxScore || result.score <= 0) return 'wrong';
  if (result.score >= result.maxScore) return 'right';
  return 'partial';
}

function totalScore() {
  return state.puzzle.questions.reduce(function (sum, question, i) {
    return sum + scoreOf(question, state.responses[i]).score;
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

  var submit = element('button', 'button', 'Submit');
  submit.type = 'button';
  submit.disabled = true;
  mount.appendChild(submit);

  var widget = handler.render(question, widgetHost, function () {
    submit.disabled = widget.getResponse() === null;
  });

  submit.addEventListener('click', function () {
    var response = widget.getResponse();
    if (response === null) return;
    state.responses[state.index] = response;
    save(state.date, state.responses);
    revealAnswer(question, response, card, submit);
  });
}

function revealAnswer(question, response, card, submit) {
  submit.remove();

  card.querySelectorAll('input').forEach(function (input) { input.disabled = true; });

  var result = scoreOf(question, response);
  var outcome = classify(result);
  var box = element('div', 'feedback ' + outcome);

  var verdict = outcome === 'right' ? 'Correct.' : outcome === 'partial' ? 'Almost.' : 'Not quite.';
  box.appendChild(element('p', 'verdict', verdict + (result.note ? ' ' + result.note : '')));
  box.appendChild(element('p', 'points', '+' + result.score + ' points'));

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
  var button = element('button', 'button', label);
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
    var result = scoreOf(question, state.responses[i]);
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
    var result = scoreOf(question, state.responses[i]);
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

/* ---------- boot ---------- */

function start() {
  var date = requestedDate();
  state.date = date;
  document.getElementById('puzzle-date').textContent = formatDate(date);

  fetch('puzzles/' + date + '.json')
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
