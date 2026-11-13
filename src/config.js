// Every number of the game lives here. Sizes are in game pixels (the screen is 180 wide).

export const W = 180;          // width of the sea
export const SURF = 60;        // y of the water surface
export const FLOOR = 700;      // y of the sea floor
export const WORLD_H = FLOOR + 12;

export const BOAT = { x: 88, w: 84, h: 50, waterline: 40, rodTip: { x: 2, y: 4 } };
export const PIVOT = { x: BOAT.x + BOAT.rodTip.x, y: SURF - BOAT.waterline + 1 + BOAT.rodTip.y };

export const HOOK = {
  rest: 72,             // line length while swinging (the hook hangs just under the keel)
  swingDeg: 46,         // how far the hook swings to each side
  swingPeriod: 4.0,     // seconds for one full swing (slower = easier to time)
  sinkSpeed: 105,       // pixels per second going down
  throwSpeed: 100,      // sideways push the swing gives the hook when it is let go
  steerSpeed: 85,       // how fast the player can move the hook left or right on the way down
  drift: 1.2,           // how quickly the sideways push fades when nobody steers
  backSpeed: 280,       // coming back empty
  reelBase: 190,        // coming back with a catch: reelBase * reel upgrade / weight^0.8
  minReel: 22,
};

// Bringing a catch up is a small game of its own. On a track, an icon of the catch moves about.
// The player moves a box along the same track: holding pushes it right, letting go lets it fall back left.
// While the icon is inside the box the catch rises and the grip recovers. While it is outside, the grip
// drains and the catch slips back down. When the grip is gone, the catch gets away.
export const PULL = {
  push: 3.4, fall: 2.8,        // how hard the box is pushed right while holding / falls left when let go
  maxSpeed: 1.5, bounce: 0.3,  // top speed of the box, and how much it bounces off the ends
  gripStart: 0.55, gripGain: 0.3,
  slip: 10,                    // pixels per second the catch sinks back while the icon is outside the box
  reelBox: 0.025,              // every level of the Reel upgrade makes the box this much wider (share of the track)
  maxBox: 0.7,
  // per kind of catch. box = width of the box (share of the track). dart = how fast the icon moves.
  // jump = how far it goes in one move. rest = seconds between moves. loss = grip lost per second outside.
  kinds: {
    1: { box: 0.42, dart: 0.35, jump: 0.25, rest: [0.9, 1.6], loss: 0.3 },
    2: { box: 0.32, dart: 0.7, jump: 0.5, rest: [0.55, 1.2], loss: 0.42 },
    3: { box: 0.3, dart: 0.78, jump: 0.55, rest: [0.5, 1.05], loss: 0.42 },
    4: { box: 0.27, dart: 0.95, jump: 0.65, rest: [0.45, 0.95], loss: 0.46 },
    chest: { box: 0.26, dart: 0.45, jump: 0.5, rest: [0.8, 1.5], loss: 0.4 },
    junk: { box: 0.6, dart: 0, jump: 0, rest: [9, 9], loss: 0 },   // junk just hangs there
  },
};

// Upgrades. Index = level, starting at 0. The line has no limit: the hook can always reach the sea floor.
export const UPGRADES = {
  reel: { name: 'Reel', unit: 'x speed', values: [1, 1.3, 1.7, 2.2, 2.8], costs: [40, 90, 200, 400] },
  storage: { name: 'Storage', unit: 'fish', values: [16, 24, 36, 50, 70], costs: [30, 70, 150, 300] },      // the same numbers as the contract
};

// Money. Coins exist only because somebody topped up with NEAR; nothing in the game hands out coins for free.
// (On the chain a top-up is priced by the contract, from the day's prize. These numbers are the practice sea's.)
export const MONEY = { coinsPerNear: 100, packs: [1, 5, 10] };
// Two kinds of money, kept apart. Coins live inside the game: bait, upgrades, trading fish. NEAR lives outside it,
// at the Harbour: topping up coins, trading tickets, and the prizes of the draw.
// In the practice sea and the tests an account starts with some pretend NEAR to try things with.
export const WALLET = { demoNear: 10 };
// The ticket market, for NEAR. It works like a market for NFTs: every ticket has its own number; players list
// tickets at a price, others buy them; players also post offers ("I pay this much for a ticket") that holders can
// sell into. On the chain the other side is players and the computer's boats. Prices are shares of what a ticket is worth in
// today's draw (its chance of winning times the prize).
export const TICKETS = {
  fee: 0.05,                    // share of every sale that goes to the prize vault, taken from the seller
  listings: [14, 22],           // how many tickets other players put up in a day
  listPrice: [0.95, 1.7],       // ...at this share of a ticket's worth (most of them near the low end)
  offers: [4, 7],               // how many offers other players post in a day
  offerPrice: [0.6, 0.95], offerQty: [1, 5],
  sales: [18, 30],              // trades between other players in a day, for the activity list
  checkEvery: 5,                // seconds between looks at the player's own listings and offers
  sellPatience: 1.35, sellPace: 0.3,   // a listed ticket sells with chance (patience - price / worth) x pace at each look
  fillFloor: 0.75, fillPace: 0.5,      // an offer gets a ticket with chance (price / worth - floor) x pace at each look
  maxListings: 20, maxOffers: 5,
  names: ['Sari', 'Budi', 'Made', 'Ayu', 'Rizky', 'Dewi', 'Wayan', 'Lina', 'Tono', 'Putu', 'Nanda', 'Yoga', 'Mira', 'Agus', 'Citra', 'Bayu'],
};
export const BAIT = { price: 2, start: 10 };
export const START_COINS = 80;      // with the 10 bait this is the demo's first top-up of 1 NEAR

// A "day" is how often the quest board changes and the draw is held. Short for now so it can be tried quickly.
export const DAY_MS = 5 * 60 * 1000;

// zone = [top, bottom] in world y. speed in pixels per second. count = how many swim at once.
// weight slows the reel. value is the plain price; orders pay a bit more, other players pay less.
export const FISH = [
  { id: 'anchovy', name: 'Anchovy', tier: 1, w: 19, h: 12, zone: [74, 200], speed: [20, 32], weight: 1, value: 4, count: 5, respawn: [2, 5] },
  { id: 'mackerel', name: 'Mackerel', tier: 1, w: 24, h: 15, zone: [84, 210], speed: [16, 26], weight: 1.3, value: 4, count: 3, respawn: [3, 6] },
  { id: 'clownfish', name: 'Clownfish', tier: 1, w: 20, h: 18, zone: [120, 214], speed: [9, 15], weight: 1.2, value: 5, count: 2, respawn: [4, 8] },
  { id: 'snapper', name: 'Snapper', tier: 2, w: 33, h: 23, zone: [228, 380], speed: [13, 20], weight: 2.5, value: 4, count: 2, respawn: [5, 9] },
  { id: 'milkfish', name: 'Milkfish', tier: 2, w: 37, h: 20, zone: [228, 384], speed: [20, 30], weight: 2.2, value: 4, count: 2, respawn: [5, 9] },
  { id: 'grouper', name: 'Grouper', tier: 2, w: 32, h: 23, zone: [270, 390], speed: [7, 12], weight: 3.5, value: 4, count: 2, respawn: [6, 10] },
  { id: 'barracuda', name: 'Barracuda', tier: 3, w: 50, h: 21, zone: [408, 560], speed: [28, 40], weight: 4, value: 6, count: 2, respawn: [8, 14] },
  { id: 'tuna', name: 'Tuna', tier: 3, w: 53, h: 34, zone: [412, 560], speed: [22, 32], weight: 6, value: 6, count: 2, respawn: [10, 16] },
  { id: 'shark', name: 'Shark', tier: 3, w: 62, h: 33, zone: [440, 650], speed: [13, 20], weight: 8, value: 6, count: 2, respawn: [12, 20] },
  { id: 'sailfish', name: 'Sailfish', tier: 4, w: 78, h: 39, zone: [586, 652], speed: [34, 46], weight: 9, value: 60, count: 1, respawn: [25, 45], chance: 0.4 },
];

export const JUNK = [
  { id: 'flipflop', name: 'Flip-flop', sprite: 'junk_flipflop', w: 18, h: 10, zone: [110, 215], speed: [3, 6], weight: 2, count: 1, respawn: [6, 12] },
  { id: 'can', name: 'Can', sprite: 'junk_can', w: 10, h: 14, zone: [240, 390], speed: [2, 5], weight: 2, count: 1, respawn: [6, 12] },
  { id: 'tire', name: 'Tire', sprite: 'junk_tire', w: 17, h: 17, zone: [430, 660], speed: [2, 4], weight: 5, count: 1, respawn: [8, 14] },
];

// One chest sits on the sea floor. Inside is one rare thing. It is heavy, so it comes up slowly.
export const CHEST = { id: 'chest', name: 'Chest', sprite: 'chest', w: 22, h: 18, zone: [FLOOR - 18, FLOOR], speed: [0, 0], weight: 7, count: 1, respawn: [20, 40] };
export const RARE = [
  // the three finds are equally likely, so they are worth the same
  { id: 'pearl', name: 'Pearl', sprite: 'item_pearl', value: 14, odds: 1 },
  { id: 'goldbar', name: 'Gold bar', sprite: 'item_goldbar', value: 14, odds: 1 },
  { id: 'crown', name: 'Old crown', sprite: 'item_crown', value: 14, odds: 1 },
];

export const FISH_BY_ID = Object.fromEntries(FISH.map((f) => [f.id, f]));
// Everything that can sit in storage: fish and rare things.
export const ITEMS = [...FISH.map((f) => ({ ...f, sprite: `fish_${f.id}_1` })), ...RARE.map((r) => ({ ...r, rare: true }))];
export const ITEM_BY_ID = Object.fromEntries(ITEMS.map((i) => [i.id, i]));

// The daily quest: one a day, the same for every player. It asks for three kinds of things in different amounts:
// a fish from the upper water, a big fish from deep water, and something out of a chest.
// Finishing it pays a ticket, and there are only so many tickets a day for everybody together (first come, first
// served). It can be done again while tickets are left. Tickets are the only way into the draw.
// "effort" is how many throws an average player needs for one of each thing (measured, see test/effort.mjs).
// The chest item comes first (one of the three, each as likely as the others); what is left of the "budget" of
// throws is split between the two fish by "fishShare", so a ticket costs about the same bait on any day.
export const QUEST = {
  budget: 24,
  fishShare: [0.53, 0.47],
  crownTickets: 1,
  effort: { anchovy: 2.1, mackerel: 2.2, clownfish: 2.7, snapper: 1.7, milkfish: 1.7, grouper: 1.9, barracuda: 3.1, tuna: 3.1, shark: 3.0, pearl: 7.1, goldbar: 7.1, crown: 7.1 },
  stock: 400,
  // other players use up the stock little by little; it is gone somewhere in this part of the day
  goneAt: [0.6, 0.98],
};

// The draw (demo numbers for now, all of it moves on chain later): every day up to "winners" tickets win,
// each an equal share of that day's prize. A ticket never expires. Burn it to enter, or sell it.
export const DRAW = { winners: 100, prize: [120, 200], othersTickets: [300, 500] };

// The market between players inside the game, for coins: fish and chest items only (tickets trade at the Harbour).
// In the practice sea and the tests the other players are made up: they put things up for sale,
// they want to buy some, and they buy what the player puts up if the price is fair.
// A thing the day's quest asks for is worth more that day ("wantedToday"). Nobody knows tomorrow's quest.
export const MARKET = {
  fee: 0.05,                 // share of every sale that disappears (a coin sink); the seller gets the rest
  wantedToday: 1.5,
  ask: [1.1, 1.6],           // other players sell at this share of the fair price...
  bid: [0.55, 0.9],          // ...and buy at this share
  forSale: { 1: [3, 8], 2: [2, 6], 3: [1, 4], 4: [0, 1], rare: [0, 2] },   // how many they offer a day
  wanted: { 1: 10, 2: 6, 3: 4, 4: 1, rare: 2 },                 // how many they buy a day
  maxListings: 5, maxPerListing: 10,
  checkEvery: 4,             // seconds between looks at the player's listings
  patience: 1.5, pace: 0.35, // a unit sells with chance (patience - price / fair price) x pace at each look
};
