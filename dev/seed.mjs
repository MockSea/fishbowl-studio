#!/usr/bin/env node
// Seed a demo studio with two fictional brands (personas): "Northwind Bicycles", with drafts in
// every state, and "Fernhollow Bakery", a smaller second studio. Sources, topics, verdict history
// and learned interests are filled in so every board section has something to show.
// Usage: node dev/seed.mjs [folder]   (default dev/.demo-home; wipes it first)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeContext } from '../server/lib/state.js';
import { writePlaybook } from '../server/lib/config.js';
import { localDate } from '../server/lib/text.js';
import { formOf } from '../server/lib/forms.js';

const DEV = path.dirname(fileURLToPath(import.meta.url));
export const DEMO_HOME = path.join(DEV, '.demo-home');
const H = 3600e3;

export const PERSONAS = [{ slug: 'northwind-bicycles', name: 'Northwind Bicycles' }, { slug: 'fernhollow-bakery', name: 'Fernhollow Bakery' }];

export function seed(home = DEMO_HOME, now = Date.now()) {
  fs.rmSync(home, { recursive: true, force: true });
  fs.mkdirSync(home, { recursive: true });
  const created_at = new Date(now - 40 * 24 * H).toISOString();
  for (const p of PERSONAS) fs.mkdirSync(path.join(home, 'personas', p.slug), { recursive: true });
  fs.writeFileSync(path.join(home, 'personas.json'), JSON.stringify({ active: PERSONAS[0].slug, personas: PERSONAS.map((p) => ({ ...p, created_at })) }, null, 2) + '\n');
  const root = makeContext({ home, now: () => now, seed: 7 });
  const north = seedNorthwind(root.persona(PERSONAS[0].slug), now);
  const fern = seedFernhollow(root.persona(PERSONAS[1].slug), now);
  return { home, drafts: north + fern };
}

// Decided drafts spread over the last three weeks, so "learned from your verdicts" has a story to tell.
function history(d, iso, rows) {
  rows.forEach(([status, platform, topic, shape, text, daysAgo], i) => d({ status, platform, topic, shapes: [shape], text, decided_at: iso(daysAgo * 24), age: daysAgo * 24 + 2, item_id: null, kind: 'item', origin: 'item', released_at: iso(daysAgo * 24 + 1), thinking: `History ${i + 1}.` }));
}

function seedNorthwind(ctx, now) {
  const s = ctx.store;
  const iso = (hAgo) => new Date(now - hAgo * H).toISOString();
  const json = (f, o) => s.writeFile(f, JSON.stringify(o, null, 2) + '\n');

  json('settings.json', { brand: 'Northwind Bicycles', setup_complete: true, posts_per_day: 2, overused_phrases: ['at the end of the day', 'game-changer'], fetch_every: 'every_3h' });
  json('voice-samples.json', { samples: [
    { text: 'We replaced 41 brake pads last month. Every one of them squeaked first. Listen to the squeak.', platform: 'x' },
    { text: 'A cargo bike is not a lifestyle. It is a van that fits through the gap.\n\nWe have three in the workshop this week, all doing the school run.', platform: 'linkedin' },
  ] });
  s.writeFile('voice.md', `# Northwind Bicycles\n\n## Who we are\nA neighbourhood bike shop and repair workshop. We sell commuter and cargo bikes and fix everything.\n\n## Voice\nWarm, practical, a little dry. We talk like the person behind the repair bench: plain words, real detail, no hype.\n\n## Never\nNo hashtags, no exclamation marks, no "game-changer". Never name customers.\n`);
  json('beat.json', { about: 'City cycling, bike repair, cargo bikes and the policy that shapes them.', topics: ['infrastructure', 'repair', 'cargo', 'policy', 'safety'], weights: { cargo: 3, policy: 1 }, on_beat: ['city cycling', 'bike repair', 'cargo bikes'], off_limits: ['celebrity gossip', 'pro racing doping'], curiosity: { repair: ['right to repair', 'spare parts'], policy: ['tariff', 'subsidy'] }, allow_names: [] });
  json('sources.json', { feeds: [
    { name: 'Example City Cycling News', url: 'https://cycling-news.example.com/feed.xml', topic: 'infrastructure', limit: 12 },
    { name: 'Example Repair Journal', url: 'https://repair-journal.example.org/rss', topic: 'repair', limit: 12 },
    { name: 'Example Urban Freight', url: 'https://freight.example.net/atom.xml', topic: 'cargo', limit: 12 },
    { name: 'Example Transport Policy Notes', url: 'https://policy-notes.example.com/rss', topic: 'policy', limit: 12 },
    { name: 'Example Weekend Rides', url: 'https://weekend-rides.example.com/feed', topic: 'other', limit: 12, paused: true },
  ], reading: [
    { name: 'Example Materials Blog', url: 'https://materials.example.org/feed', topic: 'repair' },
    { name: 'Example Street Design Digest', url: 'https://street-design.example.org/rss', topic: 'infrastructure' },
  ], aggregator_hosts: [] });
  json('positions.json', { positions: [{ text: 'Repair before replace, every time it is safe', strength: 5 }, { text: 'Protected lanes beat painted ones', strength: 4 }, { text: 'Cargo bikes are vans for most city errands', strength: 3 }] });
  json('audience.json', { who: [{ text: 'Commuters who ride most days and fix little themselves', confidence: 3 }, { text: 'Parents eyeing a cargo bike for the school run', confidence: 2 }], buttons: [{ text: 'the hidden cost of cheap bikes', confidence: 3 }, { text: 'councils that paint a line and call it a lane', confidence: 2 }] });
  writePlaybook(s, ['Lead with the concrete detail, then what it means', 'Short beats clever on X', 'Sound like the repair bench, not the marketing desk']);

  const stories = [
    ['Riverside bridge gets 4 km of protected bike lanes', 'Example City Cycling News', 'infrastructure', 9, 'finally, kerbs not paint', 'The council finished 4 km of kerb-protected lanes on the bridge road after two years of works.'],
    ['Repair cafes report busiest autumn on record', 'Example Repair Journal', 'repair', 8, 'people want things fixed, not replaced', 'Volunteer repair cafes say bicycle visits doubled this autumn, mostly brakes and gears.'],
    ['Cargo bikes overtake vans for downtown parcel rounds', 'Example Urban Freight', 'cargo', 8, 'the van is losing the last mile', 'Couriers in the centre now run more rounds by cargo bike than by van, a city survey says.'],
    ['New guidance on charging e-bike batteries in shared housing', 'Example City Cycling News', 'safety', 7, 'boring, important, overdue', 'Landlords get guidance on safe charging rooms and certified chargers.'],
    ['Spare parts shortages ease for mid-range drivetrains', 'Example Repair Journal', 'repair', 6, 'good news for the waiting list', 'Suppliers report shorter lead times on chains and cassettes after a year of delays.'],
    ['City trials school streets on twelve roads', 'Example City Cycling News', 'policy', 7, 'quiet streets at 8:30 change everything', 'Twelve roads will close to through traffic at school times for a six-month trial.'],
    ['Survey: most riders quit over one bad junction', 'Example Urban Freight', 'safety', 6, 'it is always one junction', 'A rider survey finds a single dangerous junction is the most common reason people stop cycling.'],
    ['Winter tyre sales climb early this year', 'Example Repair Journal', 'repair', 5, 'early frost, early sense', 'Shops report studded and winter tyre sales starting three weeks earlier than usual.'],
    ['Bike parking hub opens at the central station', 'Example City Cycling News', 'infrastructure', 7, 'parking is the quiet half of cycling', 'A staffed 600-space bike hub opens beside the central station.'],
    ['Regional e-bike subsidy scheme extended', 'Example Transport Policy Notes', 'policy', 4, 'fine, but lanes matter more', 'The subsidy for e-bike purchases runs for another year.'],
    ['Library starts lending bike tools with a card', 'Example Repair Journal', 'repair', 5, 'quietly brilliant, worth a mention', 'The central library adds pumps, chain tools and torque wrenches to its lending catalogue.'],
    ['Design students reimagine the humble bike bell', 'Example City Cycling News', 'other', 3, 'cute, not ours', 'A design school show features twenty takes on the bicycle bell.'],
  ];
  const draftsSpec = [];
  ctx.tx((db) => {
    db.items = stories.map(([title, src, topic, interest, note, body], i) => ({
      id: i + 1, source: `rss:${src}`, source_name: src, topic_hint: topic, title, url: `https://news.example.com/2026/story-${i + 1}`, body,
      published: iso(2 + i * 1.5), fetched_at: iso(1 + i), story: i + 1, triaged_at: iso(1 + i), note, interest, topic,
    }));
    db.attention = db.items.map((it) => ({ item_id: it.id, topic: it.topic, interest: it.interest, decision: it.interest >= 6 ? 'drafted' : 'skipped', source: it.source, at: it.triaged_at }));
    db.discoveries = [{ id: 1, item_id: 5, topic: 'repair', finding: 'Lead times easing could mean repairs beat new bikes on price again this winter.', question: 'Do shorter waits change whether people repair or replace?', interest: 7, at: iso(5) }];
  });

  let id = 0, setId = 0;
  const d = (o) => {
    const text = o.text;
    const base = { id: ++id, set_id: null, take_n: null, kind: 'item', origin: 'item', platform: 'x', status: 'pending', created_at: iso(o.age ?? 3), released_at: iso((o.age ?? 3) - 1), lint: [], thinking: o.thinking || 'Honest first read: this is exactly the kind of thing our customers ask about at the bench.', tags: { topic: o.topic || 'other', form: formOf(text), shape_ids: o.shapes || ['plain-take'], hybrid: false, experiment: null } };
    const out = { ...base, ...o, tags: { ...base.tags, ...(o.tags || {}) } };
    delete out.age; delete out.shapes; delete out.topic;
    draftsSpec.push(out);
    return out;
  };
  const rank = (pos, of, score, extra = {}) => ({ rank: { pos, of, score, top: null, set_score: score, released: true, batch: 1, explore: false, signals: { hot: 0.8, trending: 0.3, interest: 0.9, entertaining: 0.5 }, ...extra } });

  // Waiting: a set of three takes on LinkedIn, one on X, and two singles.
  const s1 = ++setId;
  const takes1 = [
    d({ set_id: s1, take_n: 1, item_id: 1, platform: 'linkedin', status: 'option', topic: 'infrastructure', shapes: ['the-receipt'], text: 'Four kilometres of kerb.\n\nThat is what the bridge road got this week: not paint, not a dotted line, a physical kerb between people on bikes and two tonnes of traffic.\n\nWe will know it worked when the parents who never ride the bridge start showing up in the workshop with child seats to fit.', ...rank(1, 3, 0.71) }),
    d({ set_id: s1, take_n: 2, item_id: 1, platform: 'linkedin', status: 'option', topic: 'infrastructure', shapes: ['who-its-for'], tags: { experiment: 'Write it as advice to one specific kind of reader.' }, text: 'If you have been waiting for the bridge to feel safe before you try commuting by bike: this is the week.\n\nThe new lanes on the bridge road are kerb-protected end to end. Bring the bike in first and we will check the brakes for the climb.', ...rank(1, 3, 0.66) }),
    d({ set_id: s1, take_n: 3, item_id: 1, platform: 'linkedin', status: 'option', topic: 'infrastructure', shapes: ['what-happens-next'], text: 'Prediction: within a year the bridge road lanes will be too narrow.\n\nThat is what happens when you build the real thing. Protected lanes fill up. Painted ones never do.', ...rank(1, 3, 0.62) }),
  ];
  takes1.forEach((t) => (t.rank.top = takes1[0].id));
  const s2 = ++setId;
  const takes2 = [
    d({ set_id: s2, take_n: 1, item_id: 3, status: 'option', topic: 'cargo', shapes: ['two-line-turn'], text: 'The last mile used to need a van.\nNow it needs a good lock and decent rain trousers.', ...rank(2, 3, 0.64) }),
    d({ set_id: s2, take_n: 2, item_id: 3, status: 'option', topic: 'cargo', shapes: ['missing-piece'], text: 'Cargo bikes beating vans downtown is not about bikes. It is about parking.', ...rank(2, 3, 0.58) }),
    d({ set_id: s2, take_n: 3, item_id: 3, status: 'option', topic: 'cargo', shapes: ['the-question'], text: 'Who services a courier fleet of cargo bikes? Shops like ours, at 7am, with a lot of coffee.', lint: [{ code: 'number', label: 'number not in source (7)' }], ...rank(2, 3, 0.52) }),
  ];
  takes2.forEach((t) => (t.rank.top = takes2[0].id));
  d({ item_id: 2, topic: 'repair', shapes: ['plain-take'], text: 'Repair cafes had their busiest autumn yet. Brakes and gears, mostly. The most sustainable bike is the one you already own.', ...rank(3, 3, 0.6) });
  d({ item_id: 6, platform: 'linkedin', topic: 'policy', shapes: ['one-rule'], origin: 'item', revised_at: iso(1), versions: [{ text: 'School streets are good.', at: iso(2) }], text: 'A rule we use at the shop: if a nine-year-old cannot ride it alone, it is not finished.\n\nTwelve roads near schools close to through traffic at drop-off for six months. That is how you test a street against that rule.', ...rank(1, 2, 0.55, { batch: 2 }) });
  d({ item_id: 4, kind: 'item', topic: 'safety', shapes: ['plain-take'], rewriting: true, text: 'Charge e-bike batteries where you can see them, with the charger that came with them. Boring advice. The best kind.', ...rank(2, 2, 0.5, { batch: 2 }) });

  // Passed, edited, posted with numbers.
  d({ item_id: 9, status: 'passed', topic: 'infrastructure', decided_at: iso(20), age: 26, shapes: ['the-receipt'], text: '600 staffed bike spaces at the central station. Parking is the quiet half of cycling, and someone finally built it.' });
  d({ item_id: 5, status: 'edited', platform: 'linkedin', topic: 'repair', decided_at: iso(22), age: 27, shapes: ['plain-take'], text: 'Good news for anyone on our waiting list: chains and cassettes are arriving again.', final_text: 'Good news for anyone on our repair waiting list: chains and cassettes are arriving again.\n\nIf we told you "a few weeks" in the summer, we will call you this week.' });
  const posted = d({ item_id: 7, status: 'posted', topic: 'safety', decided_at: iso(48), posted_at: iso(46), age: 50, post_url: 'https://social.example.com/northwind/1', shapes: ['missing-piece'], text: 'People do not quit cycling. They quit one junction.' });
  posted.metrics_snapshots = [{ at: iso(20), views: 4200, likes: 96, replies: 14, reposts: 22, quotes: 3 }];
  posted.metrics = posted.metrics_snapshots[0];
  posted.outcome = 96 + 2 * 22 + 2 * 3 + 14;

  // Killed (one restored and killed again), passed over set, unpicked, scrapped.
  d({ item_id: 8, status: 'killed', topic: 'repair', decided_at: iso(30), age: 32, shapes: ['list-that-breaks'], text: 'Winter checklist: lights, tyres, and the courage to ride past the cafe.', restore_trail: [{ reason: 'funny, but not us', at: iso(31) }] });
  const s3 = ++setId;
  for (const [n, text] of [[1, 'Subsidies are nice. Lanes are nicer.'], [2, 'An e-bike subsidy without lanes is a discount on fear.'], [3, 'Another year of e-bike subsidy. Spend it on a good lock.']]) d({ set_id: s3, take_n: n, item_id: 10, status: 'passed_over', decided_at: iso(28), age: 30, topic: 'policy', text });
  d({ set_id: ++setId, take_n: 2, item_id: 2, status: 'unpicked', decided_at: iso(40), age: 44, topic: 'repair', text: 'Fix it before you replace it. The repair cafes agree.' });
  d({ item_id: 6, status: 'scrapped', scrap_reason: 'stale', scrapped_at: iso(10), age: 30, released_at: null, topic: 'policy', text: 'School streets: the cheapest safety upgrade a city can buy.' });
  d({ kind: 'evergreen', origin: 'evergreen', item_id: null, status: 'scrapped', scrap_reason: 'over_daily_cap', scrapped_at: iso(9), age: 14, released_at: null, platform: 'linkedin', shapes: ['one-rule'], text: 'Our one rule for buying a first commuter bike: buy the one you can get fixed locally.\n\nThe cheapest bike is the one that is still running in March.' });
  // Held for the next batch.
  d({ kind: 'evergreen', origin: 'evergreen', item_id: null, status: 'held', age: 1, released_at: null, platform: 'x', shapes: ['plain-take'], text: 'Most squeaks are a clean and a drop of oil. Most.' });
  history(d, iso, [
    ['passed', 'x', 'cargo', 'two-line-turn', 'A cargo bike carries two kids and the shopping. A van carries one adult and the guilt.', 3],
    ['posted', 'linkedin', 'cargo', 'the-receipt', 'We fitted 14 cargo bikes with rain covers in October. Fourteen families stopped asking if it is worth it.', 5],
    ['passed', 'x', 'cargo', 'missing-piece', 'The cargo bike question is never the bike. It is where to park it.', 6],
    ['edited', 'linkedin', 'infrastructure', 'the-receipt', 'Two kilometres of new kerb on the ring road. Our Monday repairs from that road: down by a third.', 8],
    ['passed', 'x', 'repair', 'plain-take', 'Most bikes in our workshop need forty minutes and a chain. Not a new bike.', 9],
    ['killed', 'x', 'policy', 'list-that-breaks', 'Three things the council should do: lanes, lanes, and, wait for it, lanes.', 10],
    ['killed', 'linkedin', 'policy', 'the-question', 'What would you do with the transport budget? Asking for a city.', 12],
    ['killed', 'x', 'other', 'list-that-breaks', 'Five signs you need a service: 1. it squeaks 2. it squeaks louder 3. ...', 14],
    ['passed', 'linkedin', 'safety', 'missing-piece', 'Lights are not for seeing. In town they are for being seen. Different job, different light.', 15],
    ['killed', 'x', 'policy', 'two-line-turn', 'Subsidy announced.\nLanes not announced.', 17],
  ]);

  ctx.tx((db) => {
    db.drafts = draftsSpec;
    db.feedback = [{ id: 1, draft_id: draftsSpec.find((x) => x.rewriting).id, text: 'Good point but it sounds like a safety leaflet. More like us.', prior_text: 'Charge batteries safely.', at: iso(1), rewrite: 'queued' }];
    db.jobs = [{ id: 1, kind: 'rewrite', draft_id: draftsSpec.find((x) => x.rewriting).id, feedback_id: 1, status: 'queued', created_at: iso(1) }];
    db.hearts = [{ id: 1, target: 'draft', ref: posted.id, note: null, snapshot: posted.text, at: iso(45) }];
    db.reversals = [{ id: 1, draft_id: draftsSpec.find((x) => x.restore_trail).id, reason: 'funny, but not us', line: 'Winter checklist…', at: iso(31) }];
    db.proposals = [
      { id: 1, kind: 'playbook', op: 'add', text: 'Name the practical consequence for a rider in the first line', reason: 'receipts and practical takes passed 5 of 6 this week', refs: [], status: 'open', source: 'weekly', created_at: iso(20) },
      { id: 2, kind: 'playbook', op: 'replace', old: 'Short beats clever on X', text: 'Short and specific beats clever on X', reason: 'the specific X posts passed, the clever ones were killed', refs: [], status: 'open', source: 'weekly', created_at: iso(20) },
      { id: 3, kind: 'audience', op: 'add', section: 'buttons', text: 'one dangerous junction that stops people riding', reason: 'post 9 drew the most replies', refs: ['post:9'], status: 'open', source: 'weekly', created_at: iso(20) },
    ];
    db.items.push({ id: 13, source: 'link:longreads.example.com', source_name: 'longreads.example.com', topic_hint: 'other', from_link: true, title: 'What a decade of cargo bike counts tells us about city errands', url: 'https://longreads.example.com/cargo-decade', body: 'A long read on ten years of cargo bike counts.', published: null, fetched_at: iso(0.5), story: 13, triaged_at: iso(0.5), note: null, interest: null, topic: 'other' });
    db.jobs.push({ id: 2, kind: 'draft_item', item_id: 13, status: 'queued', created_at: iso(0.5), from_link: true });
    db.runs.feed_errors = [{ name: 'Example Transport Policy Notes', error: 'HTTP 503' }];
    const hours = [8, 12, 16, 20];
    const hr = new Date(now).getHours();
    db.days = { [localDate(now)]: { released: 6, batches: hours.map((h, k) => (h <= hr ? k : -1)).filter((k) => k >= 0), scrapped: {}, explore_used: 0, explore_ids: [] } };
    db.weights = { current: { hot: 0.23, trending: 0.2, interest: 0.31, entertaining: 0.26 }, tuned_at: iso(2), history: [{ at: iso(8 * 24), weights: { hot: 0.25, trending: 0.2, interest: 0.3, entertaining: 0.25 } }, { at: iso(2), weights: { hot: 0.23, trending: 0.2, interest: 0.31, entertaining: 0.26 } }] };
    db.runs.last_fetch = iso(1);
  });
  s.write('meta', { ids: { draft: id, set: setId, item: 13, feedback: 1, job: 2, heart: 1, reversal: 1, proposal: 3, discovery: 1 } });
  return draftsSpec.length;
}

// A second, smaller studio: a neighbourhood bakery, one week in.
function seedFernhollow(ctx, now) {
  const s = ctx.store;
  const iso = (hAgo) => new Date(now - hAgo * H).toISOString();
  const json = (f, o) => s.writeFile(f, JSON.stringify(o, null, 2) + '\n');
  json('settings.json', { brand: 'Fernhollow Bakery', setup_complete: true, posts_per_day: 1, daily_cap: 6, takes_per_item: 2, evergreen_per_day: 1, release_hours: [9, 15], fetch_every: 'weekdays', platforms: { linkedin: { enabled: true, share: 1 }, x: { enabled: false, share: 0.5 } } });
  s.writeFile('voice.md', `# Fernhollow Bakery\n\n## Who we are\nA small neighbourhood bakery. Sourdough, seasonal pastries, and a wholesale round to four cafes.\n\n## Voice\nCalm, warm and specific. Flour-on-the-apron detail. Proud of the craft, never precious about it.\n\n## Never\nNo "artisanal", no "crafted with love", no exclamation marks.\n`);
  json('voice-samples.json', { samples: [{ text: 'The starter is eleven years old. It has outlived two ovens and one landlord.', platform: 'linkedin' }] });
  json('beat.json', { about: 'Baking, local food, small food businesses and food waste.', topics: ['baking', 'local-food', 'small-business', 'food-waste'], weights: { 'food-waste': 3 }, on_beat: ['bread', 'local food'], off_limits: ['diet fads'], curiosity: { baking: ['heritage grain'] }, allow_names: [] });
  json('sources.json', { feeds: [
    { name: 'Example Bakers Bulletin', url: 'https://bakers-bulletin.example.com/feed', topic: 'baking', limit: 12 },
    { name: 'Example Local Food Weekly', url: 'https://localfood.example.org/rss', topic: 'local-food', limit: 12 },
  ], reading: [{ name: 'Example Grain Notes', url: 'https://grain-notes.example.net/atom.xml', topic: 'baking' }], aggregator_hosts: [] });
  json('positions.json', { positions: [{ text: 'Slow bread is worth the wait', strength: 5 }, { text: 'Day-old bread is an ingredient, not waste', strength: 4 }] });
  json('audience.json', { who: [{ text: 'Neighbours who buy bread twice a week', confidence: 3 }, { text: 'Cafe owners looking for a wholesale baker', confidence: 2 }], buttons: [{ text: 'food thrown away by big chains', confidence: 2 }] });
  writePlaybook(s, ['Open with something you can smell or touch', 'One idea per post']);

  const stories = [
    ['Town market adds a Saturday grain stall', 'Example Local Food Weekly', 'local-food', 8, 'more flour, closer to home', 'A regional mill will sell stone-ground flour at the Saturday market.'],
    ['Survey: a third of bakery bread unsold by closing time', 'Example Bakers Bulletin', 'food-waste', 9, 'we can talk about this honestly', 'An industry survey estimates a third of bread baked in shops is unsold at close.'],
    ['Butter prices ease after a long climb', 'Example Bakers Bulletin', 'small-business', 6, 'croissants breathe again', 'Wholesale butter prices fell for the second month running.'],
    ['Community fridge network reaches twenty sites', 'Example Local Food Weekly', 'food-waste', 7, 'where our day-olds already go', 'A volunteer network of community fridges now runs twenty sites across the town.'],
  ];
  let id = 0;
  const drafts = [];
  const d = (o) => {
    const base = { id: ++id, set_id: null, take_n: null, kind: 'item', origin: 'item', platform: 'linkedin', status: 'pending', created_at: iso(o.age ?? 3), released_at: iso((o.age ?? 3) - 1), lint: [], thinking: o.thinking || 'This is the kind of thing customers mention at the counter.', tags: { topic: o.topic || 'other', form: formOf(o.text), shape_ids: o.shapes || ['plain-take'], hybrid: false, experiment: null } };
    const out = { ...base, ...o, tags: { ...base.tags, ...(o.tags || {}) } };
    delete out.age; delete out.shapes; delete out.topic;
    drafts.push(out);
    return out;
  };
  const rank = (pos, of, score) => ({ rank: { pos, of, score, top: null, set_score: score, released: true, batch: 1, explore: false, signals: { hot: 0.7, trending: 0.2, interest: 0.9, entertaining: 0.6 } } });
  const takes = [
    d({ set_id: 1, take_n: 1, item_id: 2, status: 'option', topic: 'food-waste', shapes: ['the-receipt'], text: 'A third of bakery bread is unsold at closing, says a new survey.\n\nOurs goes three places: the community fridge on Mill Lane, tomorrow\'s bread pudding, and the ducks. (Not the ducks. Bread is bad for ducks.)', ...rank(1, 2, 0.74) }),
    d({ set_id: 1, take_n: 2, item_id: 2, status: 'option', topic: 'food-waste', shapes: ['one-rule'], text: 'Our rule since day one: bake to the queue, not to the shelf.\n\nIt means we sometimes sell out by two. It also means almost nothing goes in the bin.', ...rank(1, 2, 0.69) }),
  ];
  takes.forEach((t) => (t.rank.top = takes[0].id));
  d({ item_id: 1, topic: 'local-food', shapes: ['plain-take'], text: 'From Saturday the mill sells stone-ground flour at the market, two stalls down from us.\n\nWe have baked with it for a year. Come and buy a bag, then come and tell us what you made.', lint: [{ code: 'news-voice', label: 'reads like a news report' }], ...rank(2, 2, 0.6) });
  d({ item_id: 3, status: 'passed', topic: 'small-business', decided_at: iso(20), age: 24, shapes: ['two-line-turn'], text: 'Butter is down for the second month running.\n\nThe croissants noticed before we did.' });
  history(d, iso, [
    ['passed', 'linkedin', 'food-waste', 'the-receipt', 'Twelve loaves to the community fridge last night. None of them came back.', 2],
    ['passed', 'linkedin', 'food-waste', 'one-rule', 'Day-old sourdough makes the best toast. That is not a slogan, it is chemistry.', 4],
    ['killed', 'linkedin', 'baking', 'list-that-breaks', 'Five breads you should try this autumn, ranked.', 5],
    ['killed', 'linkedin', 'baking', 'the-question', 'Crust or crumb? Tell us in the comments.', 6],
  ]);
  ctx.tx((db) => {
    db.items = stories.map(([title, src, topic, interest, note, body], i) => ({ id: i + 1, source: `rss:${src}`, source_name: src, topic_hint: topic, title, url: `https://news.example.org/2026/bakery-${i + 1}`, body, published: iso(3 + i * 2), fetched_at: iso(2 + i), story: i + 1, triaged_at: iso(2 + i), note, interest, topic }));
    db.attention = db.items.map((it) => ({ item_id: it.id, topic: it.topic, interest: it.interest, decision: it.interest >= 6 ? 'drafted' : 'skipped', source: it.source, at: it.triaged_at }));
    db.drafts = drafts;
    db.runs.last_fetch = iso(5);
    db.days = { [localDate(now)]: { released: 2, batches: [9, 15].map((h, k) => (h <= new Date(now).getHours() ? k : -1)).filter((k) => k >= 0), scrapped: {}, explore_used: 0, explore_ids: [] } };
  });
  s.write('meta', { ids: { draft: id, set: 1, item: stories.length } });
  return drafts.length;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const r = seed(process.argv[2] ? path.resolve(process.argv[2]) : DEMO_HOME);
  console.log(`Seeded two demo personas (Northwind Bicycles, Fernhollow Bakery; ${r.drafts} drafts) in ${r.home}`);
}
