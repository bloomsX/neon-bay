// NEON BAY — random.js
// A small seeded random number generator and the helpers the rest of the
// game uses for deterministic placement. The world, the traffic and the
// staged screenshots all draw from one seeded stream so a fixed seed always
// builds the same city, the same traffic and the same shot.

(function () {
  'use strict';

  // mulberry32: tiny, fast, good enough for placement and flavour.
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Hash a short string into a 32-bit seed so named shots get stable worlds.
  function hashString(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function makeRng(seed) {
    var next = mulberry32(typeof seed === 'string' ? hashString(seed) : seed);
    return {
      next: next,
      range: function (min, max) { return min + next() * (max - min); },
      int: function (min, max) { return Math.floor(min + next() * (max - min + 1)); },
      pick: function (arr) { return arr[Math.floor(next() * arr.length)]; },
      chance: function (p) { return next() < p; },
      sign: function () { return next() < 0.5 ? -1 : 1; },
      // Fisher-Yates shuffle, returns a new array.
      shuffle: function (arr) {
        var out = arr.slice();
        for (var i = out.length - 1; i > 0; i--) {
          var j = Math.floor(next() * (i + 1));
          var tmp = out[i]; out[i] = out[j]; out[j] = tmp;
        }
        return out;
      },
    };
  }

  // A shared, non-deterministic stream for live play flavour (ped colours,
  // idle chatter). Deterministic systems always use their own seeded stream.
  var live = makeRng((Date.now() ^ 0x9e3779b9) >>> 0);

  window.NB = window.NB || {};
  window.NB.RNG = { makeRng: makeRng, hashString: hashString, live: live };
})();
