import bcrypt from "bcryptjs";
import { getSequelize } from "../db/sequelize.js";

function models() {
  const s = getSequelize();
  if (!s) throw new Error("Database not available");
  return s.models;
}

export async function adminListUsers() {
  const { AdminUser, AdminRole } = models();
  const rows = await AdminUser.findAll({
    attributes: { exclude: ["passwordHash"] },
    include: [{ model: AdminRole, as: "roles", through: { attributes: [] }, required: false }],
    order: [["createdAt", "DESC"]],
  });
  return rows.map((r) => r.get({ plain: true }));
}

/**
 * @param {string} id
 */
export async function adminGetUser(id) {
  const { AdminUser, AdminRole } = models();
  const row = await AdminUser.findByPk(id, {
    attributes: { exclude: ["passwordHash"] },
    include: [{ model: AdminRole, as: "roles", through: { attributes: [] }, required: false }],
  });
  return row ? row.get({ plain: true }) : null;
}

/**
 * @param {object} body
 * @param {string} createdById
 */
export async function adminCreateUser(body, createdById) {
  const { AdminUser } = models();
  const email = String(body.email || "").trim().toLowerCase();
  if (!email) throw new Error("email is required");
  const exists = await AdminUser.findOne({ where: { email } });
  if (exists) throw new Error("Email already in use");
  const password = String(body.password || "");
  if (password.length < 6) throw new Error("Password must be at least 6 characters");
  const user = await AdminUser.create({
    email,
    passwordHash: await bcrypt.hash(password, 10),
    displayName: body.displayName || null,
    language: body.language || "es",
    createdById: createdById || null,
  });
  const roleIds = Array.isArray(body.roleIds) ? body.roleIds.filter(Boolean) : [];
  if (roleIds.length) await user.setRoles(roleIds);
  return adminGetUser(user.id);
}

/**
 * @param {string} id
 * @param {object} body
 */
export async function adminUpdateUser(id, body) {
  const { AdminUser } = models();
  const user = await AdminUser.findByPk(id);
  if (!user) return null;
  if (body.displayName !== undefined) user.displayName = body.displayName || null;
  if (body.language !== undefined) user.language = String(body.language || "es").slice(0, 16);
  if (body.password) {
    const password = String(body.password);
    if (password.length < 6) throw new Error("Password must be at least 6 characters");
    user.passwordHash = await bcrypt.hash(password, 10);
  }
  await user.save();
  if (Array.isArray(body.roleIds)) await user.setRoles(body.roleIds.filter(Boolean));
  return adminGetUser(id);
}

/**
 * @param {string} id
 */
export async function adminDeleteUser(id) {
  const { AdminUser } = models();
  const user = await AdminUser.findByPk(id);
  if (!user) return false;
  await user.destroy();
  return true;
}
