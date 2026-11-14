import { html, raw } from './html.js';
import { page } from './layout.js';

const STATE_WORDS = { closed: 'Finished', set_aside: 'Not now', withdrawn: 'Withdrawn' };

const csrfField = (csrf) => html`<input type="hidden" name="_csrf" value="${csrf}">`;

const BACK = html`<p class="small"><a href="/talks">Back to Talks</a></p>`;

// One button in its own form. extra is any hidden fields.
function actionForm({ talk, action, label, csrf, style = '', extra = '' }) {
  return html`<form method="post" action="/talks/${talk.id}/${action}">
${csrfField(csrf)}${extra}
<button class="btn${style ? ` ${style}` : ''}" type="submit">${label}</button>
</form>`;
}

// What the screen says at each of the seven steps. first and second are names.
export function stepContent(step, first, second) {
  const talks = 'Say what is on your mind, from your own side. Take your time.';
  switch (step) {
    case 1:
      return {
        heading: 'Before you start',
        body: 'One person talks at a time. The listener only listens. Either of you can pause at any point, no reason needed. You are on the same side.',
      };
    case 2:
      return { heading: `${first} talks. ${second} listens.`, body: talks };
    case 3:
      return {
        heading: `${second} says back what they heard.`,
        body: `Not a reply yet. Only what you heard. ${first} says if it is right.`,
      };
    case 4:
      return { heading: `${second} talks. ${first} listens.`, body: talks };
    case 5:
      return {
        heading: `${first} says back what they heard.`,
        body: `Not a reply yet. Only what you heard. ${second} says if it is right.`,
      };
    case 6:
      return { heading: 'What we each need', body: 'Each say one thing you need from here.' };
    default:
      return {
        heading: 'Agreements',
        body: 'Write down anything you have both agreed. It is fine to agree on nothing yet.',
      };
  }
}

function activeLine(talk, user) {
  if (talk.state === 'proposed') {
    return talk.proposedBy === user.id
      ? `You asked to talk about: ${talk.topic}. Waiting.`
      : `${talk.proposerName} would like to talk about: ${talk.topic}.`;
  }
  return `A talk about ${talk.topic} is going.`;
}

// active: the talk that is going, or null. earlier: every other talk, newest first.
export function talksPage({ user, csrf, active, earlier, maxTopic, maxHope, error = null, values = null }) {
  const v = values ?? { topic: '', hope: '' };
  return page({
    title: 'Talks',
    user,
    current: 'talks',
    body: html`<h1>Talks</h1>
${error ? html`<p class="message" role="alert">${error}</p>` : ''}
${
  active
    ? html`<div class="card"><p>${activeLine(active, user)}</p><p><a href="/talks/${active.id}">Open it</a></p></div>`
    : html`<h2>Ask to talk</h2>
<form class="card" method="post" action="/talks">
${csrfField(csrf)}
<div class="field">
<label for="topic">What would you like to talk about?</label>
<input id="topic" type="text" name="topic" value="${v.topic}" maxlength="${maxTopic}" autocomplete="off">
</div>
<div class="field">
<label for="hope">What I hope for (optional)</label>
<textarea id="hope" name="hope" rows="2" maxlength="${maxHope}">${v.hope}</textarea>
</div>
<button class="btn btn-primary" type="submit">Ask</button>
</form>`
}
${
  earlier.length > 0
    ? html`<h2>Earlier</h2>${earlier.map(
        (t) => html`<div class="card"><p class="muted">${t.topic}</p><p class="muted small">${STATE_WORDS[t.state] ?? ''}</p></div>`,
      )}`
    : ''
}`,
  });
}

function agreedList(agreements) {
  if (agreements.length === 0) return '';
  return html`<h2>Agreed so far</h2><div class="card">${agreements.map(
    (g) => html`<p>${g.body} <span class="muted small">· ${g.ownerLabel}</span></p>`,
  )}</div>`;
}

function agreementForm({ talk, csrf, names, form, maxLength }) {
  const option = (value, label) => html`<option value="${value}"${form.values.owner === value ? ' selected' : ''}>${label}</option>`;
  return html`<h2>Add an agreement</h2>
${form.error ? html`<p class="message" role="alert">${form.error}</p>` : ''}
<form class="card" method="post" action="/talks/${talk.id}/agreement">
${csrfField(csrf)}
<div class="field">
<label for="talk-agreement">What did you agree?</label>
<input id="talk-agreement" type="text" name="body" value="${form.values.body}" maxlength="${maxLength}" autocomplete="off">
</div>
<div class="field">
<label for="talk-owner">Who is it for?</label>
<select id="talk-owner" name="owner">
${option('both', 'Both')}
${option('a', names.a)}
${option('b', names.b)}
</select>
</div>
<button class="btn btn-primary" type="submit">Add</button>
</form>`;
}

// One talk, in whatever state it is in, as seen by one person.
// names: { a, b }. agreements: the ones made in this talk. form: { error, values } for step 7.
export function talkPage({ user, csrf, talk, names, agreements, form, maxAgreement }) {
  const isProposer = talk.proposedBy === user.id;
  const proposer = talk.proposerName;
  const other = names[talk.proposerSlot === 'a' ? 'b' : 'a'];
  const wrap = (body) => page({ title: 'Talk', user, current: 'talks', body });
  const act = (action, label, style = '', extra = '') => actionForm({ talk, action, label, csrf, style, extra });

  switch (talk.state) {
    case 'proposed':
      return wrap(html`<h1>Talk request</h1>
<p>${isProposer ? `You asked to talk about: ${talk.topic}. Waiting.` : `${proposer} would like to talk about: ${talk.topic}.`}</p>
${talk.hope ? html`<p class="muted">${isProposer ? 'What you hope for' : `What ${proposer} hopes for`}: ${talk.hope}</p>` : ''}
${
  isProposer
    ? act('withdraw', 'Withdraw', 'btn-quiet')
    : html`<div class="actions">${act('accept', "Yes, let's", 'btn-primary')}${act('not_now', 'Not now')}</div>`
}
${BACK}`);

    case 'ready':
      return wrap(html`<h1>Ready when you are</h1>
<p>You both said yes. Put the phone down between you, and start when you are both ready.</p>
${act('start', 'Start', 'btn-primary')}
${BACK}`);

    case 'in_progress': {
      const first = names[talk.firstSpeaker];
      const second = names[talk.firstSpeaker === 'a' ? 'b' : 'a'];
      const { heading, body } = stepContent(talk.step, first, second);
      const timed = talk.step === 2 || talk.step === 4;
      return wrap(html`<div class="talk-step">
<p class="muted small">Talk: ${talk.topic} · Step ${talk.step} of 7</p>
<h1>${heading}</h1>
<p>${body}</p>
${timed ? raw('<div id="timer" data-seconds="180"></div>') : ''}
${talk.step === 7 ? html`${agreedList(agreements)}${agreementForm({ talk, csrf, names, form, maxLength: maxAgreement })}` : ''}
${act('advance', talk.step === 7 ? 'Finish' : 'Next', 'btn-primary', html`<input type="hidden" name="step" value="${talk.step}">`)}
<div class="split">
${act('pause', 'Pause', 'btn-quiet')}
${act('end', 'End the talk', 'btn-quiet')}
</div>
</div>
${timed ? raw('<script src="/public/talk.js" defer></script>') : ''}`);
    }

    case 'paused':
      return wrap(html`<h1>Paused</h1>
<p>Come back when you are both ready.</p>
${act('resume', 'Resume', 'btn-primary')}
${act('end', 'End the talk', 'btn-quiet')}`);

    case 'closing':
      return wrap(html`<h1>Nearly done</h1>
<p>Press Finish when you are ready.</p>
${agreedList(agreements)}
${act('finish', 'Finish', 'btn-primary')}`);

    case 'closed':
      return wrap(html`<h1>Done</h1>
<p>Thank you both.</p>
${agreedList(agreements)}
${BACK}`);

    case 'set_aside':
      return wrap(html`<h1>Not now</h1>
<p>${isProposer ? `${other} would like to hold this for now.` : 'You said not now.'} Either of you can ask again whenever it feels right.</p>
${BACK}`);

    default:
      return wrap(html`<h1>Withdrawn</h1>
<p>This request was withdrawn.</p>
${BACK}`);
  }
}
