'use strict';

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
    var hintButton = element('button', 'button hint-button tooltip', 'Reveal Hint');
    var tooltiptext = element('span', 'tooltiptext hint-reveal', 'Receive a helpful hint at the cost of half credit for this round.');
    hintButton.appendChild(tooltiptext);
    hintButton.type = 'button';
    hintButton.addEventListener('click', function () {
      hintUsed = true;
      hintButton.disabled = true;
      card.appendChild(element('p', 'hint-reveal', question.hint));
      tooltiptext.remove();
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
      var scoreTracker = document.getElementById('score-tracker');
      scoreTracker.style.display = 'none';
      renderResults();
    } else {
      renderQuestion();
    }
  });
  return button;
}

function shareText() {
  var hintCount = 0

  var grid = state.puzzle.questions.map(function (question, i) {
    var result = scoreOf(question, state.responses[i], state.hintsUsed[i]);
    var outcome = classify(result);
    return outcome === 'right' ? '🟩' : outcome === 'partial' ? '🟨' : '🟥';
  }).join('');

  var hintGrid = state.puzzle.questions.map(function (question, i) {
    var usedHint = state.hintsUsed[i];
    if (usedHint) hintCount += 1;

    return usedHint ? '💡' : '⬛';
  }).join('');

  return 'Unusuale ' + state.date + '\n' + grid + '  ' +
    totalScore() + '/' + maxPossibleScore() + ' pts\n' + hintGrid + '  ' + (hintCount === 0 ? 'No hints' : hintCount === 1 ? '1 hint' : hintCount + ' hints') + ' used\n';
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

  var copy = element('button', 'button copy-button', 'Copy result');
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
// shapes handle their own Enter (see the stopPropagation in
// question-types.js) so this only ever sees the keystroke when nothing on
// the map absorbed it first.
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
        var scoreTracker = document.getElementById('score-tracker');
        scoreTracker.style.display = 'none';
      } else {
        renderQuestion();
      }
    })
    .catch(function () {
      renderError('There is no puzzle for ' + date + ' yet. Check back tomorrow.');
    });
}

start();
