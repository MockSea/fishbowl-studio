#!/usr/bin/env node
// Seed a demo studio with two fictional brands (personas): "Northwind Bicycles", with drafts in
// every state, and "Fernhollow Bakery", a smaller second studio. Sources, topics, verdict history
// and learned interests are filled in so every board section has something to show. Northwind
// finished the setup wizard and has "Post for me" on for X (posts scheduled, posted, missed and
// failed); Fernhollow is partway through re-running setup, with Claude's drafts waiting for them.
// Usage: node dev/seed.mjs [folder]   (default dev/.demo-home; wipes it first)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeContext } from '../server/lib/state.js';
import { writePlaybook, validateConfig } from '../server/lib/config.js';
import { localDate } from '../server/lib/text.js';
import { formOf } from '../server/lib/forms.js';
import { editDiff } from '../server/lib/learn.js';
import { textHash, nextSlot } from '../server/lib/posting.js';

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

// Decided drafts spread over the last three weeks, so "learned from your verdicts" has a story to
// tell. A row that names its source gets an old story from that feed, so each source has a record.
function history(d, iso, rows, items = [], firstItem = 100) {
  rows.forEach(([status, platform, topic, shape, text, daysAgo, src, extra = {}], i) => {
    let item_id = null;
    if (src) {
      item_id = firstItem + items.length;
      items.push({ id: item_id, source: src.startsWith('reddit:') ? src : `rss:${src}`, source_name: src.startsWith('reddit:') ? `r/${src.slice(7)}` : src, topic_hint: topic, title: `Earlier story ${i + 1} on ${topic}`, url: `https://news.example.com/archive/${firstItem}-${i + 1}`, body: 'An older story.', published: iso(daysAgo * 24 + 6), fetched_at: iso(daysAgo * 24 + 5), story: item_id, triaged_at: iso(daysAgo * 24 + 5), note: 'older read', interest: 6, topic });
    }
    d({ status, platform, topic, shapes: [shape], text, decided_at: iso(daysAgo * 24), age: daysAgo * 24 + 2, item_id, kind: 'item', origin: 'item', released_at: iso(daysAgo * 24 + 1), thinking: `History ${i + 1}.`, ...extra });
  });
}

// Their edits, as the board stores them: the draft, their version, and what changed.
const editRows = (iso, rows) => rows.map(([before, after, daysAgo, topic], i) => ({ id: i + 1, draft_id: null, before, after, platform: 'x', topic, shape_ids: [], at: iso(daysAgo * 24), diff: editDiff(before, after) }));

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
  json('sources.json', validateConfig('sources.json', { feeds: [
    { name: 'Example City Cycling News', url: 'https://cycling-news.example.com/feed.xml', topic: 'infrastructure', limit: 12 },
    { name: 'Example Repair Journal', url: 'https://repair-journal.example.org/rss', topic: 'repair', limit: 12 },
    { name: 'Example Urban Freight', url: 'https://freight.example.net/atom.xml', topic: 'cargo', limit: 12 },
    { name: 'Example Transport Policy Notes', url: 'https://policy-notes.example.com/rss', topic: 'policy', limit: 12 },
    { name: 'Example Weekend Rides', url: 'https://weekend-rides.example.com/feed', topic: 'other', limit: 12, paused: true },
    { kind: 'reddit', sub: 'examplebikecommute', name: 'r/examplebikecommute', topic: 'infrastructure', limit: 12 },
  ], reading: [
    { name: 'Example Materials Blog', url: 'https://materials.example.org/feed', topic: 'repair' },
    { name: 'Example Street Design Digest', url: 'https://street-design.example.org/rss', topic: 'infrastructure' },
  ], watch: [
    { handle: '@example_lanes', name: 'Example Lanes Collective', topic: 'infrastructure' },
    { url: 'https://www.linkedin.com/company/example-urban-freight-co/', name: 'Example Urban Freight Co', topic: 'cargo' },
  ], trends: [{ platform: 'x', topic: 'other' }],
  searches: [{ q: 'e-bike regulation', topic: 'policy' }, { q: 'bike commuting', topic: 'infrastructure' }],
  aggregator_hosts: [] }));
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
  d({ item_id: 8, status: 'killed', topic: 'repair', decided_at: iso(30), age: 32, shapes: ['list-that-breaks'], text: 'Winter checklist: lights, tyres, and the courage to ride past the cafe.', restore_trail: [{ reason: 'funny, but not us', at: iso(31) }], kill_reason: 'off_brand' });
  const s3 = ++setId;
  for (const [n, text] of [[1, 'Subsidies are nice. Lanes are nicer.'], [2, 'An e-bike subsidy without lanes is a discount on fear.'], [3, 'Another year of e-bike subsidy. Spend it on a good lock.']]) d({ set_id: s3, take_n: n, item_id: 10, status: 'passed_over', decided_at: iso(28), age: 30, topic: 'policy', text });
  d({ set_id: ++setId, take_n: 2, item_id: 2, status: 'unpicked', decided_at: iso(40), age: 44, topic: 'repair', text: 'Fix it before you replace it. The repair cafes agree.' });
  d({ item_id: 6, status: 'scrapped', scrap_reason: 'stale', scrapped_at: iso(10), age: 30, released_at: null, topic: 'policy', text: 'School streets: the cheapest safety upgrade a city can buy.' });
  d({ kind: 'evergreen', origin: 'evergreen', item_id: null, status: 'scrapped', scrap_reason: 'over_daily_cap', scrapped_at: iso(9), age: 14, released_at: null, platform: 'linkedin', shapes: ['one-rule'], text: 'Our one rule for buying a first commuter bike: buy the one you can get fixed locally.\n\nThe cheapest bike is the one that is still running in March.' });
  // Held for the next batch.
  d({ kind: 'evergreen', origin: 'evergreen', item_id: null, status: 'held', age: 1, released_at: null, platform: 'x', shapes: ['plain-take'], text: 'Most squeaks are a clean and a drop of oil. Most.' });
  // "Post for me" is on for X: approved posts Claude scheduled, posted, missed and couldn't post.
  // Evergreen posts, so they don't move the story and source records the other pages show.
  const ev = { kind: 'evergreen', origin: 'evergreen', item_id: null, shapes: ['plain-take'] };
  const toPost = d({ ...ev, status: 'passed', decided_at: iso(0.5), age: 4, text: 'The last mile used to need a van.\nNow it needs a cargo bike and a mechanic who opens at 7.' });
  const byClaude = d({ ...ev, status: 'posted', decided_at: iso(30), posted_at: iso(28), age: 33, post_url: 'https://x.com/example_northwind/status/101', posted_by: 'claude', posted_from: 'passed', text: 'A squeak is a question. Usually the answer is a clean and a drop of oil.' });
  const missed = d({ ...ev, status: 'passed', decided_at: iso(27), age: 29, text: 'The cheapest upgrade on any bike is air. Check your tyres on Sunday night.' });
  const failed = d({ ...ev, status: 'passed', decided_at: iso(52), age: 54, text: 'Chains and cassettes are back on the shelves. If we said "a few weeks" in summer, we meant it.' });
  const oldItems = [];
  history(d, iso, [
    ['passed', 'x', 'cargo', 'two-line-turn', 'A cargo bike carries two kids and the shopping. A van carries one adult and the guilt.', 3, 'Example Urban Freight'],
    ['posted', 'linkedin', 'cargo', 'the-receipt', 'We fitted 14 cargo bikes with rain covers in October. Fourteen families stopped asking if it is worth it.', 5, 'Example Urban Freight'],
    ['passed', 'x', 'cargo', 'missing-piece', 'The cargo bike question is never the bike. It is where to park it.', 6, 'Example Urban Freight'],
    ['edited', 'linkedin', 'infrastructure', 'the-receipt', 'Two kilometres of new kerb on the ring road. Our Monday repairs from that road: down by a third.', 8, 'Example City Cycling News'],
    ['passed', 'x', 'repair', 'plain-take', 'Most bikes in our workshop need forty minutes and a chain. Not a new bike.', 9, 'Example Repair Journal'],
    ['killed', 'x', 'policy', 'list-that-breaks', 'Three things the council should do: lanes, lanes, and, wait for it, lanes.', 10, 'Example Transport Policy Notes', { kill_reason: 'wrong_topic' }],
    ['killed', 'linkedin', 'policy', 'the-question', 'What would you do with the transport budget? Asking for a city.', 12, 'Example Transport Policy Notes', { kill_reason: 'wrong_topic' }],
    ['killed', 'x', 'other', 'list-that-breaks', 'Five signs you need a service: 1. it squeaks 2. it squeaks louder 3. ...', 14, 'reddit:examplebikecommute', { kill_reason: 'boring' }],
    ['passed', 'linkedin', 'safety', 'missing-piece', 'Lights are not for seeing. In town they are for being seen. Different job, different light.', 15, 'Example City Cycling News'],
    ['killed', 'x', 'policy', 'two-line-turn', 'Subsidy announced.\nLanes not announced.', 17, 'Example Transport Policy Notes', { kill_reason: 'too_salesy' }],
  ], oldItems, 14);

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
    db.items.push(...oldItems);
    // What Claude read on the X and LinkedIn pages and in their saved searches, triaged like news.
    const web = [
      ['watch:x:@example_lanes', 'Example Lanes Collective', 'Ride count on the bridge road this morning: 412 bikes before 9. Last spring it was 140.', 'https://x.com/example_lanes/status/1', 'infrastructure', 8, 'a number worth repeating', 'watch'],
      ['watch:x:@example_lanes', 'Example Lanes Collective', 'Reminder that a painted line is not a lane. Kerbs or it did not happen.', 'https://x.com/example_lanes/status/2', 'infrastructure', 6, 'same fight as ours', 'watch'],
      ['watch:linkedin:company/example-urban-freight-co', 'Example Urban Freight Co', 'Our cargo fleet passed 10,000 deliveries in the old town this quarter, with zero parking tickets.', 'https://www.linkedin.com/company/example-urban-freight-co/', 'cargo', 7, 'parking is the whole story', 'watch'],
      ['trends:x', 'Trending on X', 'Car-free Sunday', 'https://x.com/explore/tabs/trending', 'other', 4, 'nice, but no angle for a shop', 'trends'],
    ];
    const searchHits = [
      ['e-bike regulation', 'Region drafts speed rules for shared e-bikes', 'https://cycling-policy.example.org/2026/speed-rules', 'policy', 7],
      ['e-bike regulation', 'What the new e-bike battery standard means for riders', 'https://cycling-policy.example.org/2026/battery-standard', 'safety', 7],
      ['bike commuting', 'Commuters log record winter mileage', 'https://cycling-policy.example.org/2026/winter-miles', 'infrastructure', 6],
      ['bike commuting', 'Ten tips for a dry commute', 'https://tips.example.net/dry-commute', 'other', 3],
    ];
    let wid = 40;
    for (const [src, name, text, url, topic, interest, note, kind] of web) db.items.push({ id: wid++, source: src, source_name: name, topic_hint: topic, title: text.length > 140 ? text.slice(0, 137) + '…' : text, url, dedupe_key: `${src}#${wid}`, body: text, published: iso(3), fetched_at: iso(2), story: wid - 1, triaged_at: iso(2), note, interest, topic, web: kind, via: 'browser', author: null });
    for (const [q, title, url, topic, interest] of searchHits) db.items.push({ id: wid++, source: `search:${q}`, source_name: `Search: ${q}`, topic_hint: topic, title, url, body: '', published: iso(30), fetched_at: iso(26 + wid), story: wid - 1, triaged_at: iso(26 + wid), note: interest >= 6 ? 'worth a look' : 'generic', interest, topic, web: 'search', via: 'search', found_by: q, author: null });
    db.hearts.push({ id: 2, target: 'read', ref: 42, note: null, snapshot: 'parking is the whole story', at: iso(1) }, { id: 3, target: 'read', ref: 3, note: null, snapshot: 'the van is losing the last mile', at: iso(4) });
    db.runs.last_web_read = iso(2);
    db.runs.browser = { ok: true, at: iso(2) };
    db.runs.web_status = { 'watch:linkedin:company/example-urban-freight-co': { status: 'login_wall', via: 'browser', posts: 1, at: iso(2) }, 'watch:x:@example_lanes': { status: 'read', via: 'browser', posts: 2, at: iso(2) } };
    // Their edits: they keep cutting the opening question and the summing-up last line.
    db.edits = editRows(iso, [
      ['Ever wondered why the bridge feels safer? Four kilometres of kerb. That is why.', 'Four kilometres of kerb. That is why the bridge feels safer.', 2, 'infrastructure'],
      ['Who fixes a courier fleet? Shops like ours, at dawn. Game-changer for the high street.', 'Shops like ours fix the courier fleets, at dawn.', 4, 'cargo'],
      ['Is your chain squeaking? Most squeaks are a clean and a drop of oil. Game-changer, honestly.', 'Most squeaks are a clean and a drop of oil.', 6, 'repair'],
      ['Ready for winter? Studded tyres are selling three weeks early this year. Worth thinking about.', 'Studded tyres are selling three weeks early this year.', 9, 'repair'],
      ['What makes a lane a lane? A kerb. Paint is a suggestion.', 'A kerb makes a lane. Paint is a suggestion.', 12, 'infrastructure'],
      ['Repair cafes had their busiest autumn. We love to see it! The most sustainable bike is the one you own.', 'Repair cafes had their busiest autumn. The most sustainable bike is the one you own.', 16, 'repair'],
      ['Six hundred bike spaces at the station. Parking is the quiet half of cycling, and someone finally built it.', 'Six hundred staffed bike spaces at the station. Parking is the quiet half of cycling.', 20, 'infrastructure'],
    ]);
    db.proposals.push(
      { id: 4, kind: 'playbook', op: 'add', text: 'Open with a plain statement, not a question', reason: 'You cut the opening question in 5 of your last 7 edits.', refs: ['edits:5/7'], key: 'edits:cut_opening_question', status: 'open', source: 'edits', created_at: iso(20) },
      { id: 5, kind: 'phrase', op: 'add', text: 'game-changer', reason: 'You cut "game-changer" from 2 of the 2 drafts that had it.', refs: [], key: 'phrase:game-changer', status: 'rejected', source: 'edits', created_at: iso(30), decided_at: iso(29) },
      { id: 6, kind: 'source', op: 'add', text: 'Daily news: cycling-policy.example.org', target: { kind: 'site', url: 'https://cycling-policy.example.org/', list: 'feeds' }, key: 'site:cycling-policy.example.org', reason: '3 good results from 2 of your searches in the last month, over 3 days.', refs: ['item:44', 'item:45', 'item:46'], status: 'open', source: 'discovery', created_at: iso(6) },
      { id: 7, kind: 'source', op: 'add', text: 'Watch @example_cargo on X', target: { kind: 'watch', url: 'https://x.com/example_cargo' }, key: 'watch:https://x.com/example_cargo', reason: 'parents planning the school run talk here', refs: [], status: 'open', source: 'chat', created_at: iso(30) },
    );
    db.coach = [
      { id: 1, week: localDate(now - 7 * 24 * H), at: iso(7 * 24), summary: 'A quieter week. Cargo posts carried it; policy takes kept missing.', working: ['Cargo posts: you approved all 3.'], not_working: ['Policy posts: 3 skipped.'], try: ['One cargo post a day while it lasts.'] },
      { id: 2, week: localDate(now), at: iso(20), summary: 'Your best week yet for cargo and infrastructure: 7 approved of 8. Policy is still the weak spot, and you keep cutting opening questions.',
        working: ['Cargo bike posts: you approved 3 of 3, and one was your most-replied post.', 'Receipt-style posts that lead with a number: 2 of 2 approved.'],
        not_working: ['Policy stories: 3 skipped as wrong topic or too salesy.', 'Posts that open with a question: you rewrote the opening in 5 of 7 edits.'],
        try: ['Open on the concrete detail and let the question go.', 'Try one post from the Example Lanes Collective ride counts.', 'Pause Example Transport Policy Notes for two weeks and see if you miss it.'] },
    ];
    // X posts for them; Threads was on for a week and they turned it off again.
    db.accounts = [
      { type: 'x', status: 'connected_by_prompt', at: iso(48), posting: { on: true, history: [{ on: true, at: iso(46) }] } },
      { type: 'threads', status: 'connected_by_prompt', at: iso(24 * 9), posting: { on: false, history: [{ on: true, at: iso(24 * 8) }, { on: false, at: iso(24 * 2) }] } },
    ];
    // A release hour, some days back.
    const slotAt = (daysAgo, h) => { const t = new Date(now); t.setDate(t.getDate() - daysAgo); t.setHours(h, 0, 0, 0); return t.toISOString(); };
    const post = (id, dr, extra) => ({ id, draft_id: dr.id, type: 'x', approved_hash: textHash(dr.final_text || dr.text), approved_at: dr.decided_at, scheduled_at: dr.decided_at, claimed_at: null, checked_at: null, done_at: null, url: null, reason: null, seen_at: null, again: false, ...extra });
    db.posts = [
      post(1, byClaude, { slot: slotAt(1, 12), status: 'posted', claimed_at: slotAt(1, 12), checked_at: slotAt(1, 12), done_at: slotAt(1, 12), url: byClaude.post_url }),
      post(2, toPost, { slot: nextSlot({ release_hours: [8, 12, 16, 20], posts_per_day: 2 }, now, []), status: 'scheduled' }),
      post(3, missed, { slot: slotAt(1, 16), status: 'missed', done_at: slotAt(1, 18), reason: 'Nothing ran between 16:00 and 17:00: your computer was asleep or Claude was closed. It wasn\'t posted.' }),
      post(4, failed, { slot: slotAt(2, 12), status: 'failed', code: 'not_signed_in', claimed_at: slotAt(2, 12), done_at: slotAt(2, 12), reason: 'You weren\'t signed in, so Claude couldn\'t post it. (x.com showed the sign-in page)' }),
    ];
    // They finished the setup wizard when they started; everything Claude drafted is long since decided.
    db.wizard = { step: 'done', brand: 'Northwind Bicycles', link: 'https://northwind-bicycles.example.com/', answers: { audience: 'Commuters and parents in town thinking about a cargo bike', tone: 'Warm, practical, a little dry. Never salesy.', topics: 'repair, cargo bikes, safer streets', off_limits: 'Racing gossip, naming customers' }, site: { url: 'https://northwind-bicycles.example.com/', title: 'Northwind Bicycles: repairs and cargo bikes', at: iso(24 * 40) }, brief_id: null, fixed: false, requested_at: iso(24 * 40), drafted_at: iso(24 * 40), proposal_ids: [8, 9, 10], source_ids: [11], started_at: iso(24 * 40), updated_at: iso(24 * 40), finished_at: iso(24 * 40) };
    db.proposals.push(
      { id: 8, kind: 'voice', op: 'set', text: 'A neighbourhood bike shop and repair workshop. Warm, practical, a little dry.', reason: 'Drafted from your setup answers', refs: [], status: 'accepted', edited: true, source: 'wizard', created_at: iso(24 * 40), decided_at: iso(24 * 40) },
      { id: 9, kind: 'topic', op: 'add', text: 'cargo', reason: 'Drafted from your setup answers', refs: [], status: 'accepted', source: 'wizard', created_at: iso(24 * 40), decided_at: iso(24 * 40) },
      { id: 10, kind: 'topic', op: 'avoid', text: 'pro racing doping', reason: 'Drafted from your setup answers', refs: [], status: 'accepted', source: 'wizard', created_at: iso(24 * 40), decided_at: iso(24 * 40) },
      { id: 11, kind: 'source', op: 'add', text: 'Daily news: cycling-news.example.com', target: { kind: 'site', url: 'https://cycling-news.example.com/feed.xml', list: 'feeds' }, key: 'site:cycling-news.example.com', reason: 'city cycling news for your topics', refs: [], status: 'accepted', source: 'wizard', created_at: iso(24 * 40), decided_at: iso(24 * 40) },
    );
  });
  s.write('meta', { ids: { draft: id, set: setId, item: 60, feedback: 1, job: 2, heart: 3, reversal: 1, proposal: 11, discovery: 1, edit: 7, coach: 2, post: 4 } });
  return draftsSpec.length;
}

// A second, smaller studio: a neighbourhood bakery, one week in.
function seedFernhollow(ctx, now) {
  const s = ctx.store;
  const iso = (hAgo) => new Date(now - hAgo * H).toISOString();
  const json = (f, o) => s.writeFile(f, JSON.stringify(o, null, 2) + '\n');
  json('settings.json', { brand: 'Fernhollow Bakery', setup_complete: true, posts_per_day: 1, daily_cap: 6, takes_per_item: 2, evergreen_per_day: 1, release_hours: [9, 15], fetch_every: 'weekdays', platforms: { linkedin: { enabled: true, share: 1 }, x: { enabled: false, share: 0.5 }, threads: { enabled: true, share: 0.5 }, bluesky: { enabled: true, share: 0.5 } } });
  s.writeFile('voice.md', `# Fernhollow Bakery\n\n## Who we are\nA small neighbourhood bakery. Sourdough, seasonal pastries, and a wholesale round to four cafes.\n\n## Voice\nCalm, warm and specific. Flour-on-the-apron detail. Proud of the craft, never precious about it.\n\n## Never\nNo "artisanal", no "crafted with love", no exclamation marks.\n`);
  json('voice-samples.json', { samples: [{ text: 'The starter is eleven years old. It has outlived two ovens and one landlord.', platform: 'linkedin' }] });
  json('beat.json', { about: 'Baking, local food, small food businesses and food waste.', topics: ['baking', 'local-food', 'small-business', 'food-waste'], weights: { 'food-waste': 3 }, on_beat: ['bread', 'local food'], off_limits: ['diet fads'], curiosity: { baking: ['heritage grain'] }, allow_names: [] });
  json('sources.json', validateConfig('sources.json', { feeds: [
    { name: 'Example Bakers Bulletin', url: 'https://bakers-bulletin.example.com/feed', topic: 'baking', limit: 12 },
    { name: 'Example Local Food Weekly', url: 'https://localfood.example.org/rss', topic: 'local-food', limit: 12 },
    { kind: 'reddit', sub: 'examplebreadbakers', name: 'r/examplebreadbakers', topic: 'baking', limit: 12 },
  ], reading: [{ name: 'Example Grain Notes', url: 'https://grain-notes.example.net/atom.xml', topic: 'baking' }],
  watch: [{ url: 'https://www.linkedin.com/company/example-stone-mill/', name: 'Example Stone Mill', topic: 'local-food' }],
  searches: [{ q: 'bakery food waste', topic: 'food-waste' }], aggregator_hosts: [] }));
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
  d({ item_id: 4, platform: 'threads', topic: 'food-waste', shapes: ['plain-take'], text: 'Twenty community fridges in town now. Ours is the one on Mill Lane, and it gets the day-olds every evening at six.', ...rank(2, 2, 0.57) });
  d({ item_id: 4, platform: 'bluesky', topic: 'food-waste', shapes: ['two-line-turn'], text: 'Twenty community fridges in town.\nOne of them smells of yesterday’s sourdough.', ...rank(2, 2, 0.52) });
  const oldItems = [];
  history(d, iso, [
    ['passed', 'linkedin', 'food-waste', 'the-receipt', 'Twelve loaves to the community fridge last night. None of them came back.', 2, 'Example Local Food Weekly'],
    ['passed', 'linkedin', 'food-waste', 'one-rule', 'Day-old sourdough makes the best toast. That is not a slogan, it is chemistry.', 4, 'Example Local Food Weekly'],
    ['killed', 'linkedin', 'baking', 'list-that-breaks', 'Five breads you should try this autumn, ranked.', 5, 'Example Bakers Bulletin', { kill_reason: 'boring' }],
    ['killed', 'linkedin', 'baking', 'the-question', 'Crust or crumb? Tell us in the comments.', 6, 'reddit:examplebreadbakers', { kill_reason: 'off_brand' }],
  ], oldItems, 10);
  ctx.tx((db) => {
    db.items = stories.map(([title, src, topic, interest, note, body], i) => ({ id: i + 1, source: `rss:${src}`, source_name: src, topic_hint: topic, title, url: `https://news.example.org/2026/bakery-${i + 1}`, body, published: iso(3 + i * 2), fetched_at: iso(2 + i), story: i + 1, triaged_at: iso(2 + i), note, interest, topic }));
    db.attention = db.items.map((it) => ({ item_id: it.id, topic: it.topic, interest: it.interest, decision: it.interest >= 6 ? 'drafted' : 'skipped', source: it.source, at: it.triaged_at }));
    db.drafts = drafts;
    db.runs.last_fetch = iso(5);
    db.days = { [localDate(now)]: { released: 2, batches: [9, 15].map((h, k) => (h <= new Date(now).getHours() ? k : -1)).filter((k) => k >= 0), scrapped: {}, explore_used: 0, explore_ids: [] } };
    db.items.push(...oldItems,
      { id: 20, source: 'watch:linkedin:company/example-stone-mill', source_name: 'Example Stone Mill', topic_hint: 'local-food', title: 'New this month: a heritage wheat flour milled two miles from the market.', url: 'https://www.linkedin.com/company/example-stone-mill/', dedupe_key: 'watch:linkedin:company/example-stone-mill#1', body: 'New this month: a heritage wheat flour milled two miles from the market. Small batches, Saturdays only.', published: iso(8), fetched_at: iso(5), story: 20, triaged_at: iso(5), note: 'our flour, their news', interest: 7, topic: 'local-food', web: 'watch', via: 'search', author: null },
      { id: 21, source: 'search:bakery food waste', source_name: 'Search: bakery food waste', topic_hint: 'food-waste', title: 'How small bakeries cut waste with pre-orders', url: 'https://smallfood.example.net/preorders', body: '', published: iso(40), fetched_at: iso(6), story: 21, triaged_at: iso(6), note: 'we do this already', interest: 7, topic: 'food-waste', web: 'search', via: 'search', found_by: 'bakery food waste', author: null });
    // No browser tool on the last run: the LinkedIn page was looked up with web search instead.
    db.runs.last_web_read = iso(5);
    db.runs.browser = { ok: false, at: iso(5) };
    db.runs.web_status = { 'watch:linkedin:company/example-stone-mill': { status: 'no_browser', via: 'search', posts: 1, at: iso(5) }, 'search:bakery food waste': { status: 'read', via: 'search', posts: 1, at: iso(5) } };
    db.edits = editRows(iso, [
      ['A third of bakery bread goes unsold! Here is what we do about it.', 'A third of bakery bread goes unsold. Here is where ours goes.', 1, 'food-waste'],
      ['Butter is finally down! The croissants noticed before we did.', 'Butter is down. The croissants noticed before we did.', 3, 'small-business'],
      ['Fresh flour at the market this Saturday! Come say hello.', 'Stone-ground flour at the market this Saturday, two stalls down.', 5, 'local-food'],
      ['Our starter turns eleven this week! It has outlived two ovens.', 'Our starter turns eleven this week. It has outlived two ovens and one landlord.', 6, 'baking'],
    ]);
    db.proposals = [
      { id: 1, kind: 'playbook', op: 'add', text: 'No exclamation marks', reason: 'You took out the exclamation marks in 4 of your last 4 edits.', refs: ['edits:4/4'], key: 'edits:cut_exclamation', status: 'open', source: 'edits', created_at: iso(10) },
      { id: 2, kind: 'source', op: 'add', text: 'Daily news: smallfood.example.net', target: { kind: 'site', url: 'https://smallfood.example.net/', list: 'feeds' }, key: 'site:smallfood.example.net', reason: '3 good results from your search in the last month, over 3 days.', refs: [], status: 'open', source: 'discovery', created_at: iso(6) },
    ];
    // LinkedIn connected, "Post for me" left off: they copy posts out by hand.
    db.accounts = [{ type: 'linkedin', status: 'connected_by_prompt', at: iso(24 * 6) }];
    db.posts = [];
    // They re-ran setup after a month (Settings › Run setup again): Claude's new drafts are waiting.
    const wiz = (pid, kind, op, text, extra = {}) => ({ id: pid, kind, op, text, old: null, reason: 'Drafted from your setup answers', refs: [], section: null, name: null, platforms: null, strength: null, key: null, status: 'open', source: 'wizard', created_at: iso(0.4), ...extra });
    db.proposals.push(
      wiz(3, 'voice', 'set', '## Who we are\nA small neighbourhood bakery on Mill Lane: sourdough, seasonal pastries and a wholesale round to four cafes.\n\n## Voice\nCalm, warm and specific. Flour-on-the-apron detail. Proud of the craft, never precious about it.\n\n## Never\nNo "artisanal", no exclamation marks, no diet talk.'),
      wiz(4, 'playbook', 'add', 'Name one thing you can smell, touch or taste in the first line'),
      wiz(5, 'playbook', 'add', 'Say where the day-olds go, with the number'),
      wiz(6, 'topic', 'add', 'heritage grain'),
      wiz(7, 'topic', 'add', 'wholesale'),
      wiz(8, 'topic', 'avoid', 'diet fads and "clean eating"'),
      wiz(9, 'audience', 'add', 'Cafe owners within a short drive looking for a wholesale baker', { section: 'who' }),
      { id: 10, kind: 'source', op: 'add', text: 'Daily news: grain-and-mill.example.org', target: { kind: 'site', url: 'https://grain-and-mill.example.org/feed', list: 'feeds' }, key: 'site:grain-and-mill.example.org', reason: 'Milling and heritage grain news, for your baking topic', refs: [], status: 'open', source: 'wizard', created_at: iso(0.4) },
      { id: 11, kind: 'source', op: 'add', text: 'Search: wholesale bakery cafes', target: { kind: 'search', q: 'wholesale bakery cafes' }, key: 'search:wholesale bakery cafes', reason: 'For your wholesale topic', refs: [], status: 'open', source: 'wizard', created_at: iso(0.4) },
    );
    db.wizard = { step: 'review', brand: 'Fernhollow Bakery', link: 'https://fernhollow-bakery.example.org/', answers: { audience: 'Neighbours who buy bread twice a week, and cafe owners', tone: 'Calm and warm, a bit of flour on the apron', topics: 'bread, local flour, what happens to the day-olds', off_limits: '' }, site: { url: 'https://fernhollow-bakery.example.org/', title: 'Fernhollow Bakery, Mill Lane', at: iso(0.5) }, brief_id: 'demo0brief01', fixed: false, requested_at: iso(0.5), drafted_at: iso(0.4), proposal_ids: [3, 4, 5, 6, 7, 8, 9], source_ids: [10, 11], started_at: iso(0.6), updated_at: iso(0.4), finished_at: iso(24 * 30) };
    db.coach = [{ id: 1, week: localDate(now), at: iso(30), summary: 'One week in: food-waste posts land, generic baking lists don’t.',
      working: ['Food-waste posts: you approved both, and they sound most like you.'], not_working: ['Listicles about bread: skipped as boring.'],
      try: ['A post about where the day-olds go, with the number from last night.', 'One post from the Stone Mill’s new flour.'] }];
  });
  s.write('meta', { ids: { draft: id, set: 1, item: 21, edit: 4, proposal: 11, coach: 1 } });
  return drafts.length;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const r = seed(process.argv[2] ? path.resolve(process.argv[2]) : DEMO_HOME);
  console.log(`Seeded two demo personas (Northwind Bicycles, Fernhollow Bakery; ${r.drafts} drafts) in ${r.home}`);
}
