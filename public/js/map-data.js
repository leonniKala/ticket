/*
 * Ticket to Ride – Europe: map data (cities, routes, destination tickets).
 * Shared by the browser (board rendering) and the Node server (game rules).
 *
 * Coordinates are in board units: the board is BOARD.width x BOARD.height,
 * with the score track running around the edge (BOARD.track wide).
 */
(function (root, factory) {
  const data = factory();
  if (typeof module === 'object' && module.exports) module.exports = data;
  else root.TTR_MAP = data;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const BOARD = { width: 1430, height: 964, track: 34 };

  // Train card colours. 'gray' routes accept any single colour.
  const COLORS = ['purple', 'white', 'blue', 'yellow', 'orange', 'black', 'red', 'green'];

  // Points scored when claiming a route of a given length.
  const ROUTE_POINTS = { 1: 1, 2: 2, 3: 4, 4: 7, 5: 10, 6: 15, 7: 18, 8: 21 };

  // id: [display name, x, y, lat, lon, label position: compass point or [dx, dy, text-anchor]]
  const CITY_LIST = {
    edinburgh:      ['Edinburgh',      231,  91, 55.95,  -3.19, [-8, 20, 'end']],
    london:         ['London',         322, 296, 51.51,  -0.13, [-12, 7, 'end']],
    amsterdam:      ['Amsterdam',      457, 294, 52.37,   4.90, [-8, -11, 'end']],
    bruxelles:      ['Bruxelles',      423, 360, 50.85,   4.35, [-10, -8, 'end']],
    dieppe:         ['Dieppe',         306, 414, 49.92,   1.08, [-16, -12, 'end']],
    brest:          ['Brest',          189, 450, 48.39,  -4.49, [-6, 22, 'end']],
    paris:          ['Paris',          376, 474, 48.86,   2.35, [-31, 29, 'end']],
    essen:          ['Essen',          565, 297, 51.46,   7.01, [-10, 17, 'end']],
    frankfurt:      ['Frankfurt',      544, 414, 50.11,   8.68, [13, 22, 'start']],
    berlin:         ['Berlin',         695, 328, 52.52,  13.40, [-12, -23, 'end']],
    kobenhavn:      ['København',      658, 168, 55.68,  12.57, [10, 17, 'start']],
    stockholm:      ['Stockholm',      800,  61, 59.33,  18.07, [-10, -8, 'end']],
    danzig:         ['Danzig',         855, 222, 54.35,  18.65, [-6, 22, 'end']],
    riga:           ['Riga',           962, 101, 56.95,  24.11, [-12, 7, 'end']],
    petrograd:      ['Petrograd',     1191,  93, 59.93,  30.34, [6, -13, 'start']],
    wilno:          ['Wilno',         1070, 284, 54.69,  25.28, [-6, 22, 'end']],
    smolensk:       ['Smolensk',      1221, 291, 54.78,  32.05, [10, 17, 'start']],
    moskva:         ['Moskva',        1326, 256, 55.76,  37.62, [12, 4, 'start']],
    warszawa:       ['Warszawa',       918, 315, 52.23,  21.01, [-26, -17, 'end']],
    kyiv:           ['Kyiv',          1122, 390, 50.45,  30.52, [10, -19, 'start']],
    kharkov:        ['Kharkov',       1304, 461, 49.99,  36.23, [-10, -8, 'end']],
    rostov:         ['Rostov',        1360, 533, 47.24,  39.71, [-8, 20, 'end']],
    sevastopol:     ['Sevastopol',    1231, 635, 44.62,  33.52, [10, -8, 'start']],
    sochi:          ['Sochi',         1352, 656, 43.60,  39.73, [-13, 19, 'end']],
    erzurum:        ['Erzurum',       1328, 827, 39.90,  41.27, [-12, 7, 'end']],
    angora:         ['Angora',        1219, 854, 39.93,  32.86, [-5, 30, 'middle']],
    smyrna:         ['Smyrna',        1055, 890, 38.42,  27.14, [10, 17, 'start']],
    constantinople: ['Constantinople',1108, 778, 41.01,  28.98, [-14, 8, 'end']],
    bucuresti:      ['București',     1045, 615, 44.43,  26.10, [12, 7, 'start']],
    sofia:          ['Sofia',          962, 702, 42.70,  23.32, [-13, 19, 'end']],
    athina:         ['Athina',         941, 854, 37.98,  23.73, [10, 17, 'start']],
    sarajevo:       ['Sarajevo',       871, 689, 43.86,  18.41, [-11, 22, 'end']],
    brindisi:       ['Brindisi',       766, 750, 40.63,  17.94, [12, 4, 'start']],
    palermo:        ['Palermo',        703, 902, 38.12,  13.36, [10, 17, 'start']],
    roma:           ['Roma',           654, 716, 41.90,  12.50, [-8, 20, 'end']],
    venezia:        ['Venezia',        642, 592, 45.44,  12.32, [-6, 22, 'end']],
    zagrab:         ['Zagrab',         758, 610, 45.81,  15.98, [12, 4, 'start']],
    budapest:       ['Budapest',       840, 520, 47.50,  19.04, [29, -3, 'start']],
    wien:           ['Wien',           775, 482, 48.21,  16.37, [-8, 20, 'end']],
    munchen:        ['München',        619, 462, 48.14,  11.58, [12, -10, 'start']],
    zurich:         ['Zürich',         531, 550, 47.38,   8.54, [-16, 21, 'end']],
    marseille:      ['Marseille',      494, 676, 43.30,   5.37, [12, 4, 'start']],
    pamplona:       ['Pamplona',       286, 679, 42.81,  -1.64, [8, 20, 'start']],
    barcelona:      ['Barcelona',      302, 800, 41.39,   2.17, [12, 7, 'start']],
    madrid:         ['Madrid',         154, 794, 40.42,  -3.70, [-6, 22, 'end']],
    lisboa:         ['Lisboa',          66, 826, 38.72,  -9.14, [-6, 34, 'middle']],
    cadiz:          ['Cádiz',          154, 893, 36.53,  -6.29, [10, 17, 'start']],
  };

  const cities = {};
  for (const [id, [name, x, y, lat, lon, label]] of Object.entries(CITY_LIST)) {
    cities[id] = { id, name, x, y, lat, lon, label };
  }

  /*
   * Routes: [cityA, cityB, colour, length, options]
   * options: t = tunnel, f = number of locomotives required (ferry),
   *          via = waypoints the track curves through, ordered from cityA to cityB,
   *          bend = +1/-1 side to curve towards if the straight line is too short.
   * Double routes are two separate entries between the same cities.
   */
  const ROUTE_LIST = [
    ['amsterdam', 'bruxelles', 'black', 1],
    ['amsterdam', 'essen', 'yellow', 3, { via: [[497, 246]] }],
    ['amsterdam', 'frankfurt', 'white', 2],
    ['amsterdam', 'london', 'gray', 2, { f: 2 }],
    ['angora', 'constantinople', 'gray', 2, { t: 1 }],
    ['angora', 'erzurum', 'black', 3, { via: [[1296, 884]] }],
    ['angora', 'smyrna', 'orange', 3, { t: 1 }],
    ['athina', 'brindisi', 'gray', 4, { f: 1, via: [[865, 872], [795, 822]] }],
    ['athina', 'sarajevo', 'green', 4, { via: [[872, 800]] }],
    ['athina', 'smyrna', 'gray', 2, { f: 1, via: [[1000, 852]] }],
    ['athina', 'sofia', 'purple', 3],
    ['barcelona', 'madrid', 'yellow', 2],
    ['barcelona', 'marseille', 'gray', 4],
    ['barcelona', 'pamplona', 'gray', 2, { t: 1, via: [[304, 738]] }],
    ['berlin', 'danzig', 'gray', 4, { via: [[728, 226]] }],
    ['berlin', 'essen', 'blue', 2],
    ['berlin', 'frankfurt', 'black', 3, { via: [[628, 386]] }],
    ['berlin', 'frankfurt', 'red', 3, { via: [[628, 386]] }],
    ['berlin', 'warszawa', 'purple', 4],
    ['berlin', 'warszawa', 'yellow', 4],
    ['berlin', 'wien', 'green', 3],
    ['brest', 'dieppe', 'orange', 2],
    ['brest', 'pamplona', 'purple', 4, { via: [[250, 528], [264, 618]] }],
    ['brest', 'paris', 'black', 3],
    ['brindisi', 'palermo', 'gray', 3, { f: 1 }],
    ['brindisi', 'roma', 'white', 2],
    ['bruxelles', 'dieppe', 'green', 2, { via: [[390, 368], [340, 402]] }],
    ['bruxelles', 'frankfurt', 'blue', 2],
    ['bruxelles', 'paris', 'yellow', 2],
    ['bruxelles', 'paris', 'red', 2],
    ['bucuresti', 'budapest', 'gray', 4, { t: 1 }],
    ['bucuresti', 'constantinople', 'yellow', 3],
    ['bucuresti', 'kyiv', 'gray', 4],
    ['bucuresti', 'sevastopol', 'white', 4, { via: [[1140, 570]] }],
    ['bucuresti', 'sofia', 'gray', 2, { t: 1 }],
    ['budapest', 'kyiv', 'gray', 6, { t: 1, via: [[925, 445], [1030, 422]] }],
    ['budapest', 'sarajevo', 'purple', 3],
    ['budapest', 'wien', 'red', 1],
    ['budapest', 'wien', 'white', 1],
    ['budapest', 'zagrab', 'orange', 2],
    ['cadiz', 'lisboa', 'blue', 2, { bend: -1 }],
    ['cadiz', 'madrid', 'orange', 3, { via: [[222, 852]] }],
    ['constantinople', 'sevastopol', 'gray', 4, { f: 2, bend: -1 }],
    ['constantinople', 'smyrna', 'gray', 2, { t: 1 }],
    ['constantinople', 'sofia', 'blue', 3],
    ['danzig', 'riga', 'black', 3],
    ['danzig', 'warszawa', 'gray', 2, { via: [[893, 264]] }],
    ['dieppe', 'london', 'gray', 2, { f: 1 }],
    ['dieppe', 'london', 'gray', 2, { f: 1 }],
    ['dieppe', 'paris', 'purple', 1],
    ['edinburgh', 'london', 'black', 4],
    ['edinburgh', 'london', 'orange', 4],
    ['erzurum', 'sevastopol', 'gray', 4, { f: 2 }],
    ['erzurum', 'sochi', 'red', 3, { t: 1 }],
    ['essen', 'frankfurt', 'green', 2],
    ['essen', 'kobenhavn', 'gray', 3, { f: 1 }],
    ['essen', 'kobenhavn', 'gray', 3, { f: 1 }],
    ['frankfurt', 'munchen', 'purple', 2, { via: [[549, 468]] }],
    ['frankfurt', 'paris', 'white', 3, { via: [[463, 452]] }],
    ['frankfurt', 'paris', 'orange', 3, { via: [[463, 452]] }],
    ['kharkov', 'kyiv', 'gray', 4, { via: [[1200, 484]] }],
    ['kharkov', 'moskva', 'gray', 4, { via: [[1362, 368]] }],
    ['kharkov', 'rostov', 'green', 2, { via: [[1356, 462]] }],
    ['kobenhavn', 'stockholm', 'yellow', 3],
    ['kobenhavn', 'stockholm', 'white', 3],
    ['kyiv', 'smolensk', 'red', 3, { via: [[1214, 366]] }],
    ['kyiv', 'warszawa', 'gray', 4],
    ['kyiv', 'wilno', 'gray', 2],
    ['lisboa', 'madrid', 'purple', 3, { via: [[80, 752], [120, 752]] }],
    ['madrid', 'pamplona', 'black', 3, { t: 1 }],
    ['madrid', 'pamplona', 'white', 3, { t: 1 }],
    ['marseille', 'pamplona', 'red', 4],
    ['marseille', 'paris', 'gray', 4],
    ['marseille', 'roma', 'gray', 4, { t: 1, via: [[572, 630]] }],
    ['marseille', 'zurich', 'purple', 2, { t: 1 }],
    ['moskva', 'petrograd', 'white', 4, { via: [[1292, 156]] }],
    ['moskva', 'smolensk', 'orange', 2],
    ['munchen', 'venezia', 'blue', 2, { t: 1 }],
    ['munchen', 'wien', 'orange', 3],
    ['munchen', 'zurich', 'yellow', 2, { t: 1, via: [[582, 513]] }],
    ['palermo', 'roma', 'gray', 4, { f: 1, bend: -1 }],
    ['palermo', 'smyrna', 'gray', 6, { f: 2 }],
    ['pamplona', 'paris', 'blue', 4],
    ['pamplona', 'paris', 'green', 4],
    ['paris', 'zurich', 'gray', 3, { t: 1 }],
    ['petrograd', 'riga', 'gray', 4],
    ['petrograd', 'stockholm', 'gray', 8, { t: 1, via: [[1150, 62], [872, 64]] }],
    ['petrograd', 'wilno', 'blue', 4],
    ['riga', 'wilno', 'green', 4, { via: [[976, 206]] }],
    ['roma', 'venezia', 'black', 2],
    ['rostov', 'sevastopol', 'gray', 4, { via: [[1250, 514]] }],
    ['rostov', 'sochi', 'gray', 2],
    ['sarajevo', 'sofia', 'gray', 2, { t: 1, via: [[916, 668]] }],
    ['sarajevo', 'zagrab', 'red', 3, { bend: -1 }],
    ['sevastopol', 'sochi', 'gray', 2, { f: 1 }],
    ['smolensk', 'wilno', 'yellow', 3],
    ['venezia', 'zagrab', 'gray', 2],
    ['venezia', 'zurich', 'green', 2, { t: 1 }],
    ['warszawa', 'wien', 'blue', 4],
    ['warszawa', 'wilno', 'red', 3, { via: [[991, 286]] }],
    ['wien', 'zagrab', 'gray', 2],
  ];

  const routes = [];
  const pairCount = {};
  for (const [a, b, color, length, opt = {}] of ROUTE_LIST) {
    if (!cities[a] || !cities[b]) throw new Error('Unknown city in route ' + a + '-' + b);
    const pair = a + '-' + b;
    pairCount[pair] = (pairCount[pair] || 0) + 1;
    routes.push({
      id: pair + (pairCount[pair] > 1 ? '-' + pairCount[pair] : ''),
      a, b, color, length,
      tunnel: !!opt.t,
      ferry: opt.f || 0,
      via: opt.via || null,
      bend: opt.bend || 0,
      points: ROUTE_POINTS[length],
    });
  }
  // Mark double routes and link the twins.
  for (const r of routes) {
    const twins = routes.filter((o) => o !== r && o.a === r.a && o.b === r.b);
    r.double = twins.length > 0;
    r.twin = twins.length ? twins[0].id : null;
    r.lane = r.double ? (r.id.endsWith('-2') ? 1 : -1) : 0;
  }

  // Destination tickets: [cityA, cityB, points]
  const LONG_TICKETS = [
    ['brest', 'petrograd', 20],
    ['cadiz', 'stockholm', 21],
    ['edinburgh', 'athina', 21],
    ['kobenhavn', 'erzurum', 21],
    ['lisboa', 'danzig', 20],
    ['palermo', 'moskva', 20],
  ];
  const TICKETS = [
    ['amsterdam', 'pamplona', 7],
    ['amsterdam', 'wilno', 12],
    ['angora', 'kharkov', 10],
    ['athina', 'angora', 5],
    ['athina', 'wilno', 11],
    ['barcelona', 'bruxelles', 8],
    ['barcelona', 'munchen', 8],
    ['berlin', 'bucuresti', 8],
    ['berlin', 'moskva', 12],
    ['berlin', 'roma', 9],
    ['brest', 'marseille', 7],
    ['brest', 'venezia', 8],
    ['bruxelles', 'danzig', 9],
    ['budapest', 'sofia', 5],
    ['edinburgh', 'paris', 7],
    ['essen', 'kyiv', 10],
    ['frankfurt', 'kobenhavn', 5],
    ['frankfurt', 'smolensk', 13],
    ['kyiv', 'petrograd', 6],
    ['kyiv', 'sochi', 8],
    ['london', 'berlin', 7],
    ['london', 'wien', 10],
    ['madrid', 'dieppe', 8],
    ['madrid', 'zurich', 8],
    ['marseille', 'essen', 8],
    ['palermo', 'constantinople', 8],
    ['paris', 'wien', 8],
    ['paris', 'zagrab', 7],
    ['riga', 'bucuresti', 10],
    ['roma', 'smyrna', 8],
    ['rostov', 'erzurum', 5],
    ['sarajevo', 'sevastopol', 8],
    ['smolensk', 'rostov', 8],
    ['sofia', 'smyrna', 5],
    ['stockholm', 'wien', 11],
    ['venezia', 'constantinople', 10],
    ['warszawa', 'smolensk', 6],
    ['zagrab', 'brindisi', 6],
    ['zurich', 'brindisi', 6],
    ['zurich', 'budapest', 6],
  ];
  const toTicket = (long) => ([a, b, points], i) => {
    if (!cities[a] || !cities[b]) throw new Error('Unknown city in ticket ' + a + '-' + b);
    return { id: (long ? 'L' : 'T') + (i + 1), a, b, points, long };
  };
  const tickets = [...LONG_TICKETS.map(toTicket(true)), ...TICKETS.map(toTicket(false))];

  const RULES = {
    trainsPerPlayer: 45,
    stationsPerPlayer: 3,
    stationPoints: 4,            // per unused station
    longestPathBonus: 10,        // European Express
    cardsPerColor: 12,
    locomotives: 14,
    faceUpCards: 5,
    startingHand: 4,
    endGameTrains: 2,            // last round starts when a player has <= 2 trains
    doubleRoutesMinPlayers: 4,   // with 2–3 players only one lane of a double route may be used
    minPlayers: 2,
    maxPlayers: 5,
  };

  return { BOARD, COLORS, ROUTE_POINTS, RULES, cities, routes, tickets };
});
