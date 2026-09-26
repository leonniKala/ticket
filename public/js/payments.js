/*
 * Which combinations of cards can pay for a route, a station or a tunnel surcharge.
 * Shared by the phones (to offer choices) and the server tests. The server re-checks everything.
 * A payment is { color, n, loco }: n cards of `color` plus `loco` locomotives.
 */
(function (root, factory) {
  const COLORS = typeof module === 'object' && module.exports
    ? require('./map-data.js').COLORS : root.TTR_MAP.COLORS;
  const api = factory(COLORS);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TTRPay = api;
})(typeof self !== 'undefined' ? self : this, function (COLORS) {
  'use strict';

  function options(total, hand, { colors = COLORS, minLoco = 0 } = {}) {
    const out = [];
    for (const c of colors) {
      const have = hand[c] || 0;
      if (!have) continue;
      for (let loco = Math.max(minLoco, total - have); loco <= Math.min(hand.loco, total - 1); loco++) {
        out.push({ color: c, n: total - loco, loco });
      }
    }
    if (hand.loco >= total && total >= minLoco) out.push({ color: null, n: 0, loco: total });
    return out.sort((a, b) => a.loco - b.loco || b.n - a.n);
  }

  function route(r, hand) {
    return options(r.length, hand, { colors: r.color === 'gray' ? COLORS : [r.color], minLoco: r.ferry });
  }

  function station(cost, hand) {
    return options(cost, hand);
  }

  function tunnelExtra(paid, extra, hand) {
    if (!paid.color) return hand.loco >= extra ? [{ color: null, n: 0, loco: extra }] : [];
    return options(extra, hand, { colors: [paid.color] });
  }

  return { route, station, tunnelExtra };
});
