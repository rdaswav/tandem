import { buildExport, exportFileName } from '../core/export.js';

export function exportRoutes(app) {
  // A file for the person who asks, with only what they may see.
  app.get('/export.json', async (req, reply) => {
    const body = JSON.stringify(buildExport(app, req.session.user.id), null, 2);
    return reply
      .code(200)
      .header('Content-Type', 'application/json; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${exportFileName(app)}"`)
      .header('Cache-Control', 'no-store')
      .send(`${body}\n`);
  });
}
