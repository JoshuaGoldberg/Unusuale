'use strict';

/* ---------- rendering ---------- */

var mount = document.getElementById('game');
var scoreTracker = document.getElementById('score-tracker');
var scoreValue = document.getElementById('score-value');
var state = { date: null, puzzle: null, index: 0, responses: [], hintsUsed: [], cardsPlayed: [] };
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

/* ---------- cards ---------- */

/* Each puzzle may hand the player a small hand of single-use cards, played
   at most one per round. A "multiplier" card scales what the round pays out;
   a "skip" card trades away the chance to answer for a guaranteed (usually
   fractional) slice of the round's points. Both read their factor from the
   puzzle JSON, so a day's hand is entirely data-driven. */

var cardRail = document.getElementById('card-rail');
var cardList = document.getElementById('card-list');
var cardSpreadButton = document.getElementById('card-spread');
var cardCycleButton = document.getElementById('card-cycle');
var armedCardId = null;   // card selected for the current round, not yet committed
var cardsPlayable = false; // true only while a round is open for answering
var onCardChange = null;   // the open round's hook, so it can resync its controls

function allCards() {
  return state.puzzle && Array.isArray(state.puzzle.cards) ? state.puzzle.cards : [];
}

function cardById(id) {
  var found = null;
  allCards().forEach(function (card) {
    if (card.id === id) found = card;
  });
  return found;
}

function cardMultiplier(card) {
  var value = Number(card && card.multiplier);
  return Number.isFinite(value) && value >= 0 ? value : 1;
}

function isSkipCard(card) {
  return !!card && card.type === 'skip';
}

// A wager card puts a side bet on the round: answer right and it pays `gain`
// on top of the usual points, answer wrong and it costs `loss`. Both come from
// the puzzle JSON, so each day's wager can be as safe or as reckless as the
// setter likes.
function isWagerCard(card) {
  return !!card && card.type === 'wager';
}

function wagerAmount(value) {
  var amount = Math.round(Number(value));
  return Number.isFinite(amount) && amount >= 0 ? amount : 0;
}

function cardGain(card) {
  return wagerAmount(card && card.gain);
}

function cardLoss(card) {
  return wagerAmount(card && card.loss);
}

// A hint card makes the round's hint free: reveal it while the card is in
// play and the round pays full credit. Only playable on a round that has a
// hint to reveal.
function isHintCard(card) {
  return !!card && card.type === 'hint';
}

// 'multiplier' | 'skip' | 'wager' | 'hint' -- used for class names and the
// score badge.
function cardKind(card) {
  return isSkipCard(card) ? 'skip' : isWagerCard(card) ? 'wager'
    : isHintCard(card) ? 'hint' : 'multiplier';
}

function cardKindLabel(card) {
  return isSkipCard(card) ? 'Skip' : isWagerCard(card) ? 'Wager'
    : isHintCard(card) ? 'Free hint' : 'Multiplier';
}

// The card's headline figure, as printed in its corner and beside the score.
function cardLabel(card) {
  if (isHintCard(card)) return 'Free hint';
  return isWagerCard(card)
    ? '+' + cardGain(card) + ' / −' + cardLoss(card)
    : formatMultiplier(cardMultiplier(card));
}

// Signed points for display: "+120", "−30", "+0".
function formatPoints(value) {
  return (value < 0 ? '−' : '+') + Math.abs(value);
}

// The card committed to a given round, or null.
function cardPlayedOn(index) {
  return cardById(state.cardsPlayed[index]);
}

// Which round a card was spent on, or -1 if it's still in hand.
function roundForCard(id) {
  return state.cardsPlayed.indexOf(id);
}

function formatMultiplier(value) {
  return '×' + (Math.round(value * 100) / 100);
}

function cardBlurb(card) {
  if (card.description) return card.description;
  if (isWagerCard(card)) {
    return 'Side bet: a right answer earns ' + cardGain(card) +
      ' bonus points on top of the round, a wrong one costs ' + cardLoss(card) + '.';
  }
  if (isHintCard(card)) return 'Reveal this round\'s hint without losing any points for it.';
  var factor = formatMultiplier(cardMultiplier(card));
  return isSkipCard(card)
    ? 'Skip this round without answering and bank ' + factor + ' of its points.'
    : 'Multiply everything this round pays out by ' + factor + '.';
}

// The badge beside the score: what the card in play does to this round, or
// nothing when no card is in play.
var roundModifier = document.getElementById('round-modifier');

function showRoundModifier(card) {
  if (!roundModifier) return;
  roundModifier.hidden = !card;
  roundModifier.className = 'round-modifier' + (card ? ' ' + cardKind(card) : '');
  roundModifier.textContent = card ? cardLabel(card) : '';
}

// True once this round's hint has been revealed. Reset by each new round.
var hintRevealed = false;

// True once a hint card has been spent mid-round, which closes the rest of
// the hand until the next round. Reset by each new round.
var handLocked = false;

// A hint card is only worth playing on a round whose hint is still hidden.
function hintCardPlayable() {
  var question = state.puzzle && state.puzzle.questions[state.index];
  return !!(question && question.hint) && !hintRevealed;
}

function setArmedCard(id) {
  if (!cardsPlayable) return;
  if (id !== null && roundForCard(id) >= 0) return;
  if (id !== null && isHintCard(cardById(id)) && !hintCardPlayable()) return;
  armedCardId = id;
  renderCards();
  if (onCardChange) onCardChange();
}

// How the hand is laid out in the rail. Neither touches game state: the
// spread toggle only un-stacks the cards, and the cycle offset only rotates
// which card sits on top of the stack.
var cardsSpread = false;
var cardCycleOffset = 0;

function handOrder(cards) {
  var offset = cards.length ? cardCycleOffset % cards.length : 0;
  return cards.slice(offset).concat(cards.slice(0, offset));
}

function renderCards() {
  if (!cardRail || !cardList) return;

  var cards = allCards();
  if (!cards.length) {
    cardRail.hidden = true;
    return;
  }
  cardRail.hidden = false;
  cardRail.classList.toggle('spread', cardsSpread);
  cardList.textContent = '';

  if (cardSpreadButton) {
    cardSpreadButton.textContent = cardsSpread ? 'Stack' : 'Spread';
    cardSpreadButton.setAttribute('aria-pressed', cardsSpread ? 'true' : 'false');
  }
  if (cardCycleButton) cardCycleButton.disabled = cards.length < 2;

  var spentNow = {};
  handOrder(cards).forEach(function (card) {
    var spentOn = roundForCard(card.id);
    var armed = armedCardId === card.id;
    var kind = cardKind(card);
    var factor = isWagerCard(card) ? '+' + cardGain(card) + '/−' + cardLoss(card)
      : isHintCard(card) ? '?' : cardLabel(card);

    var button = element('button', 'card card-' + kind);
    button.dataset.cardId = card.id;
    button.type = 'button';
    button.disabled = spentOn >= 0 || !cardsPlayable ||
      (isHintCard(card) && !hintCardPlayable());
    if (armed) button.classList.add('armed');
    if (spentOn >= 0) button.classList.add('spent');
    // Greyed out: still in hand, but barred for the open round -- the whole
    // hand once a hint card has been spent on it, or a hint card with no
    // hint left to make free. Between rounds nothing is playable, but the
    // hand stays in colour rather than flashing grey after every answer.
    var blocked = spentOn < 0 &&
      (handLocked || (cardsPlayable && isHintCard(card) && !hintCardPlayable()));
    if (blocked) button.classList.add('blocked');
    button.setAttribute('aria-pressed', armed ? 'true' : 'false');

    // Laid out like a playing card: a corner index at the top (the only part
    // left showing once the hand is stacked down the rail), the monogram in
    // the middle to match the back, and a suit mark for the card's type in
    // the bottom corner.
    var head = element('span', 'card-head');
    head.appendChild(element('span', 'card-factor', factor));
    head.appendChild(element('span', 'card-kind', cardKindLabel(card)));
    button.appendChild(head);
    button.appendChild(element('span', 'card-name', card.name || 'Card'));
    var pip = element('span', 'card-pip');
    pip.appendChild(element('span', 'card-pip-emblem', 'U'));
    button.appendChild(pip);
    button.appendChild(element('span', 'card-status',
      spentOn >= 0 ? 'Played on round ' + (spentOn + 1)
        : armed ? 'Active this round'
          : blocked ? 'Cannot play this round'
            : cardsPlayable ? 'Tap to play' : 'In hand'));
    button.appendChild(element('span', 'card-corner',
      isSkipCard(card) ? '⏭' : isWagerCard(card) ? '±' : isHintCard(card) ? '?' : '×'));

    // A spent card lies face down: the back covers the face, and carries
    // only the round it was played on.
    if (spentOn >= 0) {
      var back = element('span', 'card-back');
      back.appendChild(element('span', 'card-back-emblem', 'U'));
      back.appendChild(element('span', 'card-back-label', 'Round ' + (spentOn + 1)));
      button.appendChild(back);
    }
    button.appendChild(element('span', 'tooltiptext card-tooltip', cardBlurb(card)));

    button.addEventListener('click', function () {
      // Clicking the armed card again takes it back; only one can be armed.
      setArmedCard(armed ? null : card.id);
    });

    var item = element('li', 'card-slot');
    item.appendChild(button);
    cardList.appendChild(item);

    if (spentOn >= 0 && renderedSpent && !renderedSpent[card.id]) flipCardOver(button);
    spentNow[card.id] = spentOn >= 0;
  });

  renderedSpent = spentNow;
}

// Which cards were face down at the last render. A card that wasn't, and is
// now, has just been played, and turns over rather than appearing flipped.
// Null until the first render, so cards already spent on page load (a
// resumed game) don't all flip at once.
var renderedSpent = null;

// Squash the card edge-on and open it out again, with the back held hidden
// until the exact midpoint -- so the first half shows the face and the
// second half the back, a flip without needing a 3D two-sided card. Both
// animations run on the same clock, so nothing waits on a finish event.
function flipCardOver(node) {
  if ((reduceMotion && reduceMotion.matches) || !node.animate) return;
  var back = node.querySelector('.card-back');
  if (!back) return;
  var timing = { duration: 340 };
  node.animate([
    { transform: 'scaleX(1)', easing: 'ease-in' },
    { transform: 'scaleX(0)', offset: 0.5, easing: 'ease-out' },
    { transform: 'scaleX(1)' }
  ], timing);
  back.animate([
    { visibility: 'hidden' },
    { visibility: 'hidden', offset: 0.5 },
    { visibility: 'visible', offset: 0.5 },
    { visibility: 'visible' }
  ], timing);
}

// Re-rendering the hand rebuilds every card, which would make stacking,
// spreading and cycling snap into place. Instead each change is animated
// FLIP-style: note where every card sat, re-render, then play each card from
// its old spot back to its new one. When cycling, the card that changed
// places also swings out of the stack on its way, the way you'd pull a card
// from the bottom of a deck and drop it on top.
var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');

// Positions are taken relative to the list itself, so the rail switching
// between pinned and scrolling (see .card-rail.spread) doesn't send the cards
// flying in from wherever the rail used to be on screen.
function cardRects() {
  var origin = cardList.getBoundingClientRect();
  var rects = {};
  cardList.querySelectorAll('.card').forEach(function (node) {
    var box = node.getBoundingClientRect();
    rects[node.dataset.cardId] = { left: box.left - origin.left, top: box.top - origin.top };
  });
  return rects;
}

function rerenderCardsAnimated(movedId) {
  if ((reduceMotion && reduceMotion.matches) || !Element.prototype.animate) {
    renderCards();
    return;
  }

  var before = cardRects();
  renderCards();
  var after = cardRects();

  cardList.querySelectorAll('.card').forEach(function (node) {
    var old = before[node.dataset.cardId];
    var now = after[node.dataset.cardId];
    if (!old || !now) return;
    var dx = old.left - now.left;
    var dy = old.top - now.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;

    var frames = [{ transform: 'translate(' + dx + 'px, ' + dy + 'px)' }];
    if (node.dataset.cardId === movedId) {
      // Swing out sideways from the line of travel: to the left when the
      // hand runs down the rail, upwards when it runs across the page.
      var length = Math.sqrt(dx * dx + dy * dy);
      var swing = 28;
      var outX = -Math.abs(dy) / length * swing;
      var outY = -Math.abs(dx) / length * swing;
      frames.push({
        offset: 0.45,
        transform: 'translate(' + (dx * 0.55 + outX) + 'px, ' + (dy * 0.55 + outY) + 'px) rotate(-3deg)'
      });
    }
    frames.push({ transform: 'none' });

    node.animate(frames, {
      duration: node.dataset.cardId === movedId ? 460 : 380,
      easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)'
    });
  });
}

if (cardSpreadButton) {
  cardSpreadButton.addEventListener('click', function () {
    cardsSpread = !cardsSpread;
    rerenderCardsAnimated(null);
  });
}

// Moves the bottom card of the stack to the top, so repeated presses loop
// through the whole hand.
if (cardCycleButton) {
  cardCycleButton.addEventListener('click', function () {
    var cards = allCards();
    if (cards.length < 2) return;
    var moved = handOrder(cards)[0];
    cardCycleOffset = (cardCycleOffset + 1) % cards.length;
    rerenderCardsAnimated(moved.id);
  });
}

// Every check() derives its answer text from the question alone, so a null
// response is enough to ask for it -- handy for a round that was skipped.
function answerTextFor(question) {
  var handler = QUESTION_TYPES[question.type];
  if (!handler) return '';
  return handler.check(question, null).answerText || '';
}

function scoreOf(question, response, hintUsed, card) {
  var handler = QUESTION_TYPES[question.type];
  var maxScore = handler ? handler.maxScore : 0;
  var multiplier = card ? cardMultiplier(card) : 1;
  var cardMax = isWagerCard(card) ? maxScore + cardGain(card) : Math.round(maxScore * multiplier);

  // With a hint card in play the hint was free, so it never costs anything.
  if (isHintCard(card)) hintUsed = false;

  // A skip card never looks at the response: the round pays its fixed slice
  // whether or not the player had the faintest idea.
  if (isSkipCard(card)) {
    return {
      score: cardMax,
      maxScore: cardMax,
      answerText: answerTextFor(question),
      outcome: 'skipped'
    };
  }

  if (!handler || response === null || response === undefined) {
    return {
      score: isWagerCard(card) ? -cardLoss(card) : 0,
      maxScore: cardMax,
      answerText: '',
      outcome: 'wrong'
    };
  }
  var result = handler.check(question, response);
  // Outcome (right/partial/wrong) reflects whether the answer itself was
  // correct, computed before the hint penalty and the card multiplier --
  // getting it right after using a hint is still "Correct.", just worth
  // half the points.
  result.outcome = !maxScore || result.score <= 0 ? 'wrong'
    : result.score >= maxScore ? 'right' : 'partial';
  result.maxScore = cardMax;

  // A wager sits on top of the round's own points. A right answer earns the
  // round as usual plus the gain; a partly right one earns its partial
  // points plus the same share of the gain; a wrong one earns nothing and
  // costs the loss besides. The hint halves everything won, bonus included,
  // but never touches the loss.
  if (isWagerCard(card)) {
    if (result.outcome === 'wrong') {
      result.score = -cardLoss(card);
    } else {
      result.score += cardGain(card) * result.score / maxScore;
      if (hintUsed) result.score *= 0.5;
      result.score = Math.round(result.score);
    }
    return result;
  }

  if (hintUsed) {
    result.score = Math.round(result.score * 0.5);
  }
  result.score = Math.round(result.score * multiplier);
  return result;
}

function classify(result) {
  return result.outcome;
}

function totalScore() {
  return state.puzzle.questions.reduce(function (sum, question, i) {
    return sum + scoreOf(question, state.responses[i], state.hintsUsed[i], cardPlayedOn(i)).score;
  }, 0);
}

// The ceiling is every round at face value, whatever cards were played. A
// good multiplier or wager can carry a player past it -- "5300 / 4750" is
// half the fun -- and a skip simply leaves them short of it.
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

  armedCardId = null;
  hintRevealed = false;
  handLocked = false;
  showRoundModifier(null);
  cardsPlayable = false;
  onCardChange = null;

  var total = state.puzzle.questions.length;
  mount.appendChild(element('p', 'progress', 'Round ' + (state.index + 1) + ' of ' + total));

  var card = element('div', 'question');
  card.appendChild(element('h2', 'prompt', question.prompt));

  if (!handler) {
    card.appendChild(element('p', 'feedback wrong',
      'This round uses an unknown question type ("' + question.type + '") and has been skipped.'));
    mount.appendChild(card);
    mount.appendChild(nextButton('Skip'));
    renderCards();
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
    var tooltiptext = element('span', 'tooltiptext','Receive a helpful hint at the cost of half credit for this round.');
    hintButton.appendChild(tooltiptext);
    hintButton.type = 'button';
    hintButton.addEventListener('click', function () {
      hintUsed = true;
      hintRevealed = true;
      hintButton.disabled = true;
      card.appendChild(element('p', 'hint-reveal', question.hint));
      tooltiptext.remove();

      // Revealing the hint is what spends a selected hint card: it's played
      // on this round there and then (and flips over), and with a card now
      // committed the rest of the hand is closed until the next round. With
      // no hint card selected, re-rendering just greys the hint card out
      // for the rest of the round.
      var armed = cardById(armedCardId);
      if (isHintCard(armed)) {
        state.cardsPlayed[state.index] = armed.id;
        cardsPlayable = false;
        handLocked = true;
      }
      renderCards();
    });
    mount.appendChild(hintButton);
  }

  // Both the widget's input events and a card being armed/disarmed feed into
  // the same resync: an armed skip card makes the primary action available
  // (and renames it) even with nothing answered.
  function syncControls() {
    var armed = cardById(armedCardId);
    var answered = !!widget && widget.getResponse() !== null;

    showRoundModifier(armed);

    // The hint button's tooltip quotes its price; a hint card waives it.
    if (tooltiptext) {
      tooltiptext.textContent = isHintCard(armed)
        ? 'Free this round: your hint card covers it.'
        : 'Receive a helpful hint at the cost of half credit for this round.';
    }

    if (isSkipCard(armed)) {
      submit.textContent = 'Skip';
      submit.disabled = false;
    } else {
      submit.textContent = 'Submit';
      submit.disabled = !answered;
    }
  }

  var widget = handler.render(question, widgetHost, syncControls);

  cardsPlayable = true;
  onCardChange = syncControls;
  renderCards();

  submit.addEventListener('click', function () {
    var played = cardById(armedCardId);
    var skipping = isSkipCard(played);
    var response = skipping ? null : widget.getResponse();
    if (!skipping && response === null) return;

    state.responses[state.index] = response;
    state.hintsUsed[state.index] = hintUsed;
    state.cardsPlayed[state.index] = played ? played.id : null;

    armedCardId = null;
    cardsPlayable = false;
    handLocked = false;
    onCardChange = null;
    renderCards();

    save(state.date, state.responses, state.hintsUsed, state.cardsPlayed);
    revealAnswer(question, response, card, submit, hintUsed, played);
  });
}

function revealAnswer(question, response, card, submit, hintUsed, playedCard) {
  submit.remove();

  card.classList.add('locked');
  card.querySelectorAll('input').forEach(function (input) { input.disabled = true; });
  card.querySelectorAll('.continent-shape').forEach(function (shape) {
    shape.setAttribute('tabindex', '-1');
  });
  mount.querySelectorAll('.hint-button').forEach(function (button) { button.remove(); });

  var result = scoreOf(question, response, hintUsed, playedCard);
  var outcome = classify(result);
  var box = element('div', 'feedback ' + outcome);

  var handler = QUESTION_TYPES[question.type];
  if (handler && handler.reveal) handler.reveal(question, response, card);

  var verdict = outcome === 'right' ? 'Correct.'
    : outcome === 'partial' ? 'Almost.'
      : outcome === 'skipped' ? 'Round skipped.' : 'Not quite.';
  box.appendChild(element('p', 'verdict', verdict + (result.note ? ' ' + result.note : '')));

  // A skip pays a flat slice, so the hint penalty never entered into it.
  var notes = [];
  // Nor does it touch a lost wager, which costs the same hint or no hint.
  // And a hint card made the hint free.
  var hintCounted = outcome !== 'skipped' && !isHintCard(playedCard) &&
    !(isWagerCard(playedCard) && outcome === 'wrong');
  if (hintUsed && hintCounted) notes.push('half credit, hint used');
  box.appendChild(element('p', 'points',
    formatPoints(result.score) + ' points' + (notes.length ? ' (' + notes.join('; ') + ')' : '')));

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
  var cardCount = 0

  var grid = state.puzzle.questions.map(function (question, i) {
    var result = scoreOf(question, state.responses[i], state.hintsUsed[i], cardPlayedOn(i));
    var outcome = classify(result);
    return outcome === 'right' ? '🟩' : outcome === 'partial' ? '🟨'
      : outcome === 'skipped' ? '🟦' : '🟥';
  }).join('');

  var hintGrid = state.puzzle.questions.map(function (question, i) {
    var usedHint = state.hintsUsed[i];
    if (usedHint) hintCount += 1;

    return usedHint ? '💡' : '⬛';
  }).join('');

  var cardGrid = state.puzzle.questions.map(function (question, i) {
    var played = cardPlayedOn(i);
    if (!played) return '⬛';
    cardCount += 1;
    return isSkipCard(played) ? '⏭️' : isWagerCard(played) ? '🎲'
      : isHintCard(played) ? '🔍' : '✨';
  }).join('');

  var text = 'Unusuale ' + state.date + '\n' + grid + '  ' +
    totalScore() + '/' + maxPossibleScore() + ' pts\n' + hintGrid + '  ' + (hintCount === 0 ? 'No hints' : hintCount === 1 ? '1 hint' : hintCount + ' hints') + ' used\n';

  if (allCards().length) {
    text += cardGrid + '  ' + (cardCount === 0 ? 'No cards' : cardCount === 1 ? '1 card' : cardCount + ' cards') + ' played\n';
  }

  return text;
}

function renderResults() {
  mount.textContent = '';

  armedCardId = null;
  showRoundModifier(null);
  cardsPlayable = false;
  onCardChange = null;
  renderCards();

  mount.appendChild(element('h2', null, 'Results'));
  mount.appendChild(element('p', 'score',
    'You scored ' + totalScore() + ' out of ' + maxPossibleScore() + ' points.'));

  var summary = element('ol', 'summary');
  state.puzzle.questions.forEach(function (question, i) {
    var played = cardPlayedOn(i);
    var result = scoreOf(question, state.responses[i], state.hintsUsed[i], played);
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
  showRoundModifier(null);
  if (cardRail) cardRail.hidden = true;
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
        state.cardsPlayed = Array.isArray(saved.cardsPlayed)
          ? saved.cardsPlayed.slice(0, puzzle.questions.length)
          : [];
        state.index = state.responses.length;
      }

      setScoreDisplay(totalScore());
      renderCards();

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
