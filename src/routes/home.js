import { listOpen } from '../core/agreements.js';
import { fromTheLog } from '../core/moments.js';
import { roundByWeek, stateFor } from '../core/rounds.js';
import { activeTalk } from '../core/talks.js';
import { weekStart } from '../core/week.js';
import { homePage } from '../views/home.js';

// The viewer's own check-in state. Looking at Home never creates the week's
// round: no round yet simply means not started.
function checkinState(app, userId) {
  const start = weekStart(app.clock.now(), app.config.tz, app.config.checkinStartDay);
  const round = roundByWeek(app, start);
  return round ? stateFor(app, round, userId) : 'not_started';
}

export function homeRoutes(app) {
  app.get('/', async (req, reply) =>
    reply.html(
      homePage({
        user: req.session.user,
        csrf: req.session.csrf,
        checkinState: checkinState(app, req.session.user.id),
        talk: activeTalk(app),
        agreements: listOpen(app),
        fromLog: fromTheLog(app),
      }),
    ),
  );
}
