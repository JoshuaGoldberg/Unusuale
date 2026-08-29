'use strict';

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
        score: response === question.answerIndex ? 500 : 0,
        answerText: question.choices[question.answerIndex]
      };
    },

    maxScore: 500
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
              // stop it here so the page-wide Enter-to-submit handler in
              // game.js doesn't also fire and submit before the player can
              // review their pick.
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
        score: matched ? 100 : 0,
        answerText: question.answer
      };
    },
    maxScore: 100
  }
};
