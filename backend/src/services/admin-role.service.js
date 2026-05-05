import { getSequelize } from "../db/sequelize.js";
import { SUPERADMIN_ROLE_SLUG } from "../constants/admin-permissions.js";

function models() {
  const s = getSequelize();
  if (!s) throw new Error("Database not available");
  return s.models;
}

export async function adminListRoles() {
  const { AdminRole } = models();
  const rows = await AdminRole.findAll({ order: [["name", "ASC"]] });
  return rows.map((r) => r.get({ plain: true }));
}

/**
 * @param {string} id
 */
export async function adminGetRole(id) {
  const { AdminRole } = models();
  const row = await AdminRole.findByPk(id);
  return row ? row.get({ plain: true }) : null;
}

/**
 * @param {object} body
 */
export async function adminCreateRole(body) {
  const { AdminRole } = models();
  const name = String(body.name || "").trim();
  const slug = String(body.slug || "").trim().toLowerCase().replace(/\s+/g, "-");
  if (!name || !slug) throw new Error("name and slug are required");
  const exists = await AdminRole.findOne({ where: { slug } });
  if (exists) throw new Error("Slug already in use");
  const role = await AdminRole.create({
    name,
    slug,
    description: body.description || null,
  });
  return role.get({ plain: true });
}

/**
 * @param {string} id
 * @param {object} body
 */
export async function adminUpdateRole(id, body) {
  const { AdminRole } = models();
  const role = await AdminRole.findByPk(id);
  if (!role) return null;
  if (role.slug === SUPERADMIN_ROLE_SLUG && body.slug && body.slug !== SUPERADMIN_ROLE_SLUG) {
    throw new Error("Cannot rename Super Admin role slug");
  }
  if (body.name !== undefined) role.name = String(body.name || "").trim();
  if (body.slug !== undefined) role.slug = String(body.slug || "").trim().toLowerCase().replace(/\s+/g, "-");
  if (body.description !== undefined) role.description = body.description || null;
  await role.save();
  return role.get({ plain: true });
}

/**
 * @param {string} id
 */
export async function adminDeleteRole(id) {
  const { AdminRole } = models();
  const role = await AdminRole.findByPk(id);
  if (!role) return false;
  if (role.slug === SUPERADMIN_ROLE_SLUG) throw new Error("Cannot delete Super Admin role");
  await role.destroy();
  return true;
}
