// 编写人：Aurora
// 歌库域路由：查询、分类、导入导出模板和增删改。
'use strict';

const { sendJson, sendCsv, sendBuffer } = require('../http-utils');
const {
  buildSongsCsv,
  buildSongsWorkbook,
  parseSongsFromXlsx,
  templateSongs
} = require('../../shared/utils');

const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const prefixes = ['/api/songs', '/api/categories'];

const routes = {
  'GET /api/categories'(context, request, res) {
    sendJson(res, 200, { ok: true, data: context.songs.listCategories() });
  },

  'GET /api/songs'(context, request, res) {
    sendJson(res, 200, {
      ok: true,
      data: context.songs.list({
        query: request.query.get('query') || '',
        category: request.query.get('category') || '',
        language: request.query.get('language') || '',
        artist: request.query.get('artist') || '',
        tags: request.query.get('tags') || '',
        enabledOnly: request.query.get('enabledOnly') === 'true'
      })
    });
  },

  'GET /api/songs/template.csv'(context, request, res) {
    sendCsv(res, 'song-import-template.csv', `\uFEFF${buildSongsCsv(templateSongs())}\n`);
  },

  'GET /api/songs/template.xlsx'(context, request, res) {
    sendBuffer(res, 200, XLSX_CONTENT_TYPE, 'song-import-template.xlsx', buildSongsWorkbook(templateSongs()));
  },

  'GET /api/songs/export.csv'(context, request, res) {
    sendCsv(res, 'songs-export.csv', `\uFEFF${buildSongsCsv(context.songs.list({}))}\n`);
  },

  'GET /api/songs/export.xlsx'(context, request, res) {
    sendBuffer(res, 200, XLSX_CONTENT_TYPE, 'songs-export.xlsx', buildSongsWorkbook(context.songs.list({})));
  },

  async 'POST /api/songs/save'(context, request, res) {
    const result = context.songs.save(await request.body());
    context.broadcastSnapshot('songs:save');
    sendJson(res, 200, { ok: true, data: result });
  },

  async 'POST /api/songs/delete'(context, request, res) {
    const id = Number((await request.body()).id);
    context.songs.delete(id);
    context.broadcastSnapshot('songs:delete');
    sendJson(res, 200, { ok: true, data: { id } });
  },

  async 'POST /api/songs/toggle'(context, request, res) {
    const id = Number((await request.body()).id);
    const result = context.songs.toggle(id);
    if (!result.ok) {
      sendJson(res, 404, { ok: false, error: 'Song not found.' });
      return;
    }
    context.broadcastSnapshot('songs:toggle');
    sendJson(res, 200, { ok: true, data: { id } });
  },

  async 'POST /api/songs/import'(context, request, res) {
    const body = await request.body();
    const result = context.songs.import(Array.isArray(body.rows) ? body.rows : []);
    context.broadcastSnapshot('songs:import');
    sendJson(res, 200, { ok: true, data: result });
  },

  async 'POST /api/songs/import-xlsx'(context, request, res) {
    const body = await request.body();
    const buffer = Buffer.from(String(body.base64 || ''), 'base64');
    const result = context.songs.import(parseSongsFromXlsx(buffer));
    context.broadcastSnapshot('songs:import-xlsx');
    sendJson(res, 200, { ok: true, data: result });
  }
};

module.exports = { prefixes, routes };
