import { getVodJobModel } from "../db/sequelize.js";

/**
 * @param {object} opts
 * @param {number} opts.page
 * @param {number} opts.pageSize
 * @param {string} [opts.tenantId]
 * @param {string} [opts.status]
 */
export async function adminListClips(opts) {
  const VodJob = getVodJobModel();
  const page = Math.max(1, opts.page || 1);
  const pageSize = Math.min(100, Math.max(1, opts.pageSize || 20));
  const where = {};
  if (opts.tenantId) where.tenantId = opts.tenantId;
  if (opts.status) where.status = opts.status;
  const { rows, count } = await VodJob.findAndCountAll({
    where,
    order: [["createdAt", "DESC"]],
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });
  return {
    total: count,
    page,
    pageSize,
    items: rows.map((r) => {
      const o = r.get({ plain: true });
      return {
        id: o.id,
        tenantId: o.tenantId,
        status: o.status,
        progress: o.progress,
        phase: o.phase,
        jobKind: o.jobKind,
        editorClipId: o.editorClipId,
        clipUrl: o.clipUrl,
        outputUrl: o.outputUrl,
        createdAt: o.createdAt,
        updatedAt: o.updatedAt,
        message: o.message,
        error: o.error,
      };
    }),
  };
}

/**
 * @param {string} id
 */
export async function adminGetClipFull(id) {
  const row = await getVodJobModel().findByPk(id);
  if (!row) return null;
  return row.get({ plain: true });
}
