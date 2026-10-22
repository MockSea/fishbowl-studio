// How often the studio reads the news. The trigger is a Cowork scheduled task. A plugin can't
// create one itself, but Claude can, with Cowork's create_scheduled_task tool and their approval:
// the board's one click asks it to, with the cron expression worked out here. The preset decides
// two things: the exact schedule to give them (and Claude), and when studio_fetch actually fetches. A run that comes sooner than the preset's gap (or on a
// weekend, for weekdays) skips the fetch and still triages, drafts and releases what it has.
import { localHM } from './text.js';

const H = 3600e3;

// gap_h: the least time between two fetches (a little under the interval, so a run that
// starts a few minutes early still fetches). tasks: what to set in Cowork.
export const FETCH_PRESETS = {
  hourly: { label: 'Every hour', blurb: 'Freshest news. Claude opens briefly every hour.', gap_h: 0.75, weekdays_only: false, tasks: [{ repeat: 'Hourly', cron: () => '0 * * * *' }] },
  every_3h: { label: 'Every 3 hours', blurb: 'A good balance for busy beats.', gap_h: 2.75, weekdays_only: false, tasks: [{ repeat: 'Hourly', cron: () => '0 */3 * * *' }], note: 'Set by hand, Cowork repeats hourly; the studio only reads the news every third hour and the runs in between finish in a moment.' },
  twice_daily: { label: 'Twice a day', blurb: 'Morning and early afternoon.', gap_h: 5, weekdays_only: false, tasks: [{ repeat: 'Daily', at: 'first', cron: (h) => `0 ${h} * * *` }, { repeat: 'Daily', at: 'midday', cron: (h) => `0 ${h} * * *` }] },
  daily: { label: 'Once a day', blurb: 'One read before your first batch.', gap_h: 20, weekdays_only: false, tasks: [{ repeat: 'Daily', at: 'first', cron: (h) => `0 ${h} * * *` }] },
  weekdays: { label: 'Weekdays', blurb: 'Once a day, Monday to Friday.', gap_h: 20, weekdays_only: true, tasks: [{ repeat: 'Weekdays', at: 'first', cron: (h) => `0 ${h} * * 1-5` }] },
};
export const FETCH_KEYS = Object.keys(FETCH_PRESETS);
export const RUN_PROMPT = 'Run the Fishbowl Studio daily run.';
export const POST_PROMPT = 'Run the Fishbowl Studio posting.';

const hm = (h) => `${String(h).padStart(2, '0')}:00`;

// The task(s) to set in Cowork for a preset, with times worked out from their release hours:
// the morning run an hour before the first batch, the second one an hour before the batch
// nearest 13:00.
export function scheduleTasks(preset, releaseHours = [8, 12, 16, 20]) {
  const p = FETCH_PRESETS[preset] || FETCH_PRESETS.weekdays;
  const hours = releaseHours.length ? releaseHours : [8];
  const first = Math.max(0, hours[0] - 1);
  const later = hours.filter((h) => h - 1 > first);
  const mid = later.length ? later.reduce((a, b) => (Math.abs(b - 13) < Math.abs(a - 13) ? b : a)) - 1 : Math.min(23, first + 6);
  return p.tasks.map((t, i) => {
    const h = t.at === 'first' ? first : t.at === 'midday' ? mid : null;
    const time = h == null ? null : hm(h);
    const name = p.tasks.length > 1 ? `Fishbowl Studio run ${i + 1}` : 'Fishbowl Studio daily run';
    return { name, repeat: t.repeat, time, prompt: RUN_PROMPT, cron: t.cron(h), text: `${name}: repeat ${t.repeat}${time ? ` at ${time}` : ''}. Prompt: ${RUN_PROMPT}` };
  });
}

// When "Post for me" is on anywhere: a second task, five minutes after each release hour, that
// posts what is due. By hand, Cowork's Hourly repeat does the same (runs with nothing due end at
// once).
export function postingTask(releaseHours = [8, 12, 16, 20]) {
  const hours = [...new Set(releaseHours)].sort((a, b) => a - b);
  return { name: 'Fishbowl Studio posting', repeat: 'Hourly', time: null, prompt: POST_PROMPT, cron: `5 ${hours.join(',')} * * *`, posting: true,
    text: `Fishbowl Studio posting: repeat Hourly. Prompt: ${POST_PROMPT}` };
}

// The words the board's one click sends to Claude: create (or update) the tasks with Cowork's
// scheduled-task tool, which asks them to approve each one.
export function schedulePrompt(tasks, folder) {
  return [
    'Set up the Fishbowl Studio schedule in Cowork. First call list_scheduled_tasks; if a task with the same name exists, update it with update_scheduled_task instead of making another. Then, for each task below, call create_scheduled_task with this name, the cron expression and the prompt, in the folder ' + folder + '. Each one needs my approval; tell me in one line what you made.',
    ...tasks.map((t) => `- ${t.name}: cron "${t.cron}", prompt "${t.prompt}"`),
    'If you have no scheduled-task tool here, tell me, and I will set them up by hand from the Schedule page.',
  ].join('\n');
}

// Should a run fetch now? {fetch: true} or {fetch: false, reason}.
export function fetchDue(preset, lastFetchIso, now) {
  const p = FETCH_PRESETS[preset] || FETCH_PRESETS.weekdays;
  const day = new Date(now).getDay();
  if (p.weekdays_only && (day === 0 || day === 6)) return { fetch: false, reason: 'it is the weekend and your news setting is weekdays only' };
  if (!lastFetchIso) return { fetch: true };
  const since = now - Date.parse(lastFetchIso);
  if (since >= p.gap_h * H) return { fetch: true };
  const mins = Math.max(1, Math.round(since / 60e3));
  return { fetch: false, reason: `the news was read ${mins < 90 ? `${mins} min` : `${Math.round(mins / 60)} h`} ago (at ${localHM(Date.parse(lastFetchIso))}) and your setting is "${p.label.toLowerCase()}"` };
}

// When the next fetch can happen (ISO), for the Schedule page.
export function nextFetchAt(preset, lastFetchIso, now) {
  const p = FETCH_PRESETS[preset] || FETCH_PRESETS.weekdays;
  let t = lastFetchIso ? Math.max(now, Date.parse(lastFetchIso) + p.gap_h * H) : now;
  if (p.weekdays_only) {
    for (let i = 0; i < 3; i++) {
      const d = new Date(t);
      if (d.getDay() !== 0 && d.getDay() !== 6) break;
      d.setDate(d.getDate() + 1); d.setHours(0, 0, 0, 0);
      t = d.getTime();
    }
  }
  return new Date(t).toISOString();
}
